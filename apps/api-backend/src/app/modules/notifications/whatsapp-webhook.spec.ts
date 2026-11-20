import { createHmac } from 'crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { extractStatuses, safeEqual, verifyMetaSignature } from './whatsapp-webhook.util';
import { WhatsAppStatusService } from './whatsapp-status.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

const SECRET = 'app-secret';
const sign = (body: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const envelope = (statuses: unknown[]) => ({ entry: [{ changes: [{ value: { statuses } }] }] });

describe('verifyMetaSignature', () => {
  const body = Buffer.from('{"a":1}');

  it('accepts the correct HMAC of the raw body', () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });
  it('rejects a wrong secret, a tampered body, a missing header and a wrong scheme', () => {
    expect(verifyMetaSignature(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"a":2}'), sign(body), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body).replace('sha256', 'sha1'), SECRET)).toBe(false);
    expect(verifyMetaSignature(undefined, sign(body), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), '')).toBe(false);
  });
  it('does not throw on a malformed (non-hex / short) signature', () => {
    expect(verifyMetaSignature(body, 'sha256=zzzz', SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=', SECRET)).toBe(false);
  });
});

describe('safeEqual / extractStatuses', () => {
  it('compares tokens exactly and never matches empties', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
  it('flattens statuses out of Meta envelope and ignores incoming-message payloads', () => {
    expect(extractStatuses(envelope([{ id: 'w1', status: 'delivered' }, { id: 'w2', status: 'read' }]))).toHaveLength(2);
    expect(extractStatuses({ entry: [{ changes: [{ value: { messages: [{ id: 'x' }] } }] }] })).toEqual([]);
    expect(extractStatuses(null)).toEqual([]);
  });
});

describe('WhatsAppStatusService', () => {
  let prisma: { notificationLog: { findFirst: jest.Mock; update: jest.Mock } };
  let service: WhatsAppStatusService;

  beforeEach(() => {
    prisma = { notificationLog: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) } };
    service = new WhatsAppStatusService(prisma as any);
  });
  const row = (over: Record<string, unknown> = {}) => ({ id: 'log1', deliveryStatus: null, deliveredAt: null, errorCode: null, ...over });
  const updated = () => prisma.notificationLog.update.mock.calls.at(-1)?.[0];

  it('delivered → DELIVERED with the timestamp Meta reported', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue(row());
    expect(await service.handle(envelope([{ id: 'w1', status: 'delivered', timestamp: '1795094369' }]))).toBe(1);
    expect(updated().data).toMatchObject({ deliveryStatus: 'DELIVERED', deliveredAt: new Date(1795094369 * 1000) });
    expect(prisma.notificationLog.findFirst.mock.calls[0][0].where).toEqual({ waMessageId: 'w1' });
  });

  it('read → READ, and fills deliveredAt if the delivered report never arrived', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue(row());
    await service.handle(envelope([{ id: 'w1', status: 'read', timestamp: '1795094400' }]));
    expect(updated().data).toMatchObject({ deliveryStatus: 'READ', readAt: new Date(1795094400 * 1000), deliveredAt: new Date(1795094400 * 1000) });
  });

  it('never moves backwards: a late "delivered" after "read" changes nothing', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue(row({ deliveryStatus: 'READ' }));
    await service.handle(envelope([{ id: 'w1', status: 'delivered' }]));
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });

  it('failed → FAILED with Meta\'s reason and code, and keeps the code on the row', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue(row());
    await service.handle(
      envelope([{ id: 'w1', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Receiver is incapable of receiving this message' } }] }]),
    );
    expect(updated().data).toMatchObject({
      deliveryStatus: 'FAILED',
      deliveryError: 'Message undeliverable — Receiver is incapable of receiving this message [131026]',
      errorCode: '131026',
    });
  });

  it('a failed report never overrides a message the phone already confirmed', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue(row({ deliveryStatus: 'DELIVERED' }));
    await service.handle(envelope([{ id: 'w1', status: 'failed', errors: [{ code: 1 }] }]));
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });

  it('ignores "sent" reports and messages that are not in the log (sent outside the notification queue)', async () => {
    expect(await service.handle(envelope([{ id: 'w1', status: 'sent' }]))).toBe(0);
    expect(prisma.notificationLog.findFirst).not.toHaveBeenCalled();
    prisma.notificationLog.findFirst.mockResolvedValue(null);
    expect(await service.handle(envelope([{ id: 'unknown', status: 'delivered' }]))).toBe(0);
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });
});

describe('WhatsAppWebhookController', () => {
  const OLD = process.env;
  let statuses: { handle: jest.Mock };
  let controller: WhatsAppWebhookController;
  const body = Buffer.from(JSON.stringify(envelope([{ id: 'w1', status: 'delivered' }])));
  const req = (rawBody: Buffer | undefined) => ({ rawBody }) as any;

  beforeEach(() => {
    process.env = { ...OLD, META_WA_APP_SECRET: SECRET, META_WA_WEBHOOK_VERIFY_TOKEN: 'verify-me' };
    statuses = { handle: jest.fn().mockResolvedValue(1) };
    controller = new WhatsAppWebhookController(statuses as any);
  });
  afterEach(() => {
    process.env = OLD;
  });

  it('GET handshake echoes the challenge only for the right token', () => {
    expect(controller.verify('subscribe', 'verify-me', 'CHALLENGE')).toBe('CHALLENGE');
    expect(() => controller.verify('subscribe', 'wrong', 'CHALLENGE')).toThrow(ForbiddenException);
    expect(() => controller.verify('unsubscribe', 'verify-me', 'CHALLENGE')).toThrow(ForbiddenException);
  });

  it('GET handshake is refused outright when no verify token is configured', () => {
    delete process.env['META_WA_WEBHOOK_VERIFY_TOKEN'];
    expect(() => controller.verify('subscribe', undefined, 'CHALLENGE')).toThrow(ForbiddenException);
  });

  it('POST with a valid signature is processed', async () => {
    await expect(controller.receive(req(body), sign(body), JSON.parse(body.toString()))).resolves.toEqual({ received: true, matched: 1 });
    expect(statuses.handle).toHaveBeenCalledTimes(1);
  });

  it('POST with a bad or missing signature is rejected and changes nothing', async () => {
    await expect(controller.receive(req(body), sign(body, 'attacker'), {})).rejects.toThrow(ForbiddenException);
    await expect(controller.receive(req(body), undefined, {})).rejects.toThrow(ForbiddenException);
    expect(statuses.handle).not.toHaveBeenCalled();
  });

  it('POST is refused (fail closed) when the app secret is not configured', async () => {
    delete process.env['META_WA_APP_SECRET'];
    await expect(controller.receive(req(body), sign(body), {})).rejects.toThrow(ServiceUnavailableException);
    expect(statuses.handle).not.toHaveBeenCalled();
  });
});
