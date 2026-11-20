import { BadRequestException } from '@nestjs/common';
import { JOB_NAMES } from '@water-supply-crm/queue';
import { NotificationLogService } from './notification-log.service';

const VENDOR = 'vendor-1';
const T0 = new Date('2026-11-19T10:00:00Z');
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

const failedRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  vendorId: VENDOR,
  channel: 'WHATSAPP',
  status: 'FAILED',
  eventType: 'DELIVERY_RECEIPT',
  entityType: 'DELIVERY_ITEM',
  entityId: 'item-1',
  recipientAddress: '923001111111',
  retryable: true,
  retriedAt: null,
  createdAt: T0,
  jobName: JOB_NAMES.SEND_WHATSAPP_PDF,
  payload: { phoneNumber: '923001111111', receiptData: {}, vendorId: VENDOR, type: 'DELIVERY_RECEIPT' },
  ...over,
});

describe('NotificationLogService — retry', () => {
  let prisma: any;
  let queue: { add: jest.Mock };
  let settings: { isEnabled: jest.Mock };
  let service: NotificationLogService;

  beforeEach(() => {
    prisma = {
      notificationLog: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      dailySheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    settings = { isEnabled: jest.fn().mockResolvedValue(true) };
    service = new NotificationLogService(prisma, queue as any, settings as any);
  });

  describe('single retry', () => {
    it('re-queues with the same retry policy and tags the job with the row it retries', async () => {
      prisma.notificationLog.findFirst.mockResolvedValue(failedRow());
      await service.retry(VENDOR, 'r1');
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe(JOB_NAMES.SEND_WHATSAPP_PDF);
      expect(data).toMatchObject({ phoneNumber: '923001111111', retryOfLogId: 'r1' });
      expect(opts).toMatchObject({ attempts: 4 });
    });

    it('refuses to retry a type the vendor has since switched off — and does not mark the row retried', async () => {
      prisma.notificationLog.findFirst.mockResolvedValue(failedRow());
      settings.isEnabled.mockResolvedValue(false);
      await expect(service.retry(VENDOR, 'r1')).rejects.toThrow(BadRequestException);
      expect(prisma.notificationLog.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('bulk retry', () => {
    // planBulkRetry order: findMany(candidates), findMany(later successful sends); count(total), count(permanent)
    const plan = (candidates: any[], laterSent: any[] = [], counts: [number, number] = [candidates.length, 0]) => {
      prisma.notificationLog.findMany.mockResolvedValueOnce(candidates).mockResolvedValueOnce(laterSent);
      prisma.notificationLog.count.mockResolvedValueOnce(counts[0]).mockResolvedValueOnce(counts[1]);
    };

    it('preview separates provably-undelivered rows from older unclassified ones, and explains every skip', async () => {
      plan(
        [
          failedRow({ id: 'safe', entityId: 'i1', retryable: true }),
          failedRow({ id: 'old', entityId: 'i2', retryable: null, recipientAddress: '923002222222' }),
          failedRow({ id: 'off', entityId: 'i3', recipientAddress: '923003333333', payload: { type: 'PAYMENT_RECEIVED', phoneNumber: 'x' }, eventType: 'PAYMENT_RECEIVED' }),
          failedRow({ id: 'done', entityId: 'i4', recipientAddress: '923004444444' }),
          failedRow({ id: 'dup', entityId: 'i1', retryable: true }),
        ],
        [{ recipientAddress: '923004444444', eventType: 'DELIVERY_RECEIPT', entityId: 'i4', createdAt: later(5) }],
        [8, 3],
      );
      settings.isEnabled.mockImplementation(async (_v: string, type: string) => type !== 'PAYMENT_RECEIVED');

      const summary = await service.previewBulkRetry(VENDOR, {});

      expect(summary).toEqual({
        matching: 8,
        retryable: 1,
        legacy: 1,
        skipped: { permanent: 3, disabled: 1, alreadyDelivered: 1, duplicate: 1 },
        capped: false,
      });
    });

    it('only ever asks for FAILED WhatsApp rows that are not already retried and not known-permanent', async () => {
      plan([]);
      await service.previewBulkRetry(VENDOR, {});
      const where = JSON.stringify(prisma.notificationLog.findMany.mock.calls[0][0].where);
      expect(where).toContain('"channel":"WHATSAPP"');
      expect(where).toContain('"status":"FAILED"');
      expect(where).toContain('"retriedAt":null');
      expect(where).toContain('{"retryable":null},{"retryable":true}');
    });

    it('without includeLegacy only the provably-undelivered rows are re-queued', async () => {
      plan([failedRow({ id: 'safe', entityId: 'i1' }), failedRow({ id: 'old', entityId: 'i2', retryable: null, recipientAddress: '923002222222' })]);
      const res = await service.bulkRetry(VENDOR, {});
      expect(res).toMatchObject({ queued: 1, includedLegacy: false });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0][1]).toMatchObject({ retryOfLogId: 'safe' });
    });

    it('with includeLegacy older rows are re-queued too, staggered, each tagged with its own row', async () => {
      plan([failedRow({ id: 'a', entityId: 'i1' }), failedRow({ id: 'b', entityId: 'i2', retryable: null, recipientAddress: '923002222222' })]);
      const res = await service.bulkRetry(VENDOR, { includeLegacy: true });
      expect(res).toMatchObject({ queued: 2, includedLegacy: true });
      expect(queue.add.mock.calls.map((c) => c[1].retryOfLogId)).toEqual(['a', 'b']);
      expect(queue.add.mock.calls[0][2].delay).toBeUndefined();
      expect(queue.add.mock.calls[1][2].delay).toBeGreaterThan(0);
    });

    it('a row claimed by a concurrent click is not queued twice', async () => {
      plan([failedRow({ id: 'a' })]);
      prisma.notificationLog.updateMany.mockResolvedValue({ count: 0 });
      const res = await service.bulkRetry(VENDOR, {});
      expect(res.queued).toBe(0);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('if queueing fails the row is released so it can be retried again', async () => {
      plan([failedRow({ id: 'a' })]);
      queue.add.mockRejectedValue(new Error('redis down'));
      const res = await service.bulkRetry(VENDOR, {});
      expect(res).toMatchObject({ queued: 0, failedToQueue: 1 });
      expect(prisma.notificationLog.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { retriedAt: null } });
    });
  });

  describe('log list', () => {
    it('shows what a retried row turned into, and nothing while the retry is still pending', async () => {
      prisma.notificationLog.findMany
        .mockResolvedValueOnce([
          { ...failedRow({ id: 'a', retriedAt: T0, entityType: null, entityId: null, recipientAddress: null }), recipientType: null, recipientId: null },
          { ...failedRow({ id: 'b', retriedAt: T0, entityType: null, entityId: null, recipientAddress: null }), recipientType: null, recipientId: null },
        ])
        .mockResolvedValueOnce([{ retryOfId: 'a', status: 'SENT', createdAt: later(2), lastError: null, deliveryStatus: 'DELIVERED' }]);
      prisma.notificationLog.count.mockResolvedValue(2);

      const res: any = await service.findLogs(VENDOR, {} as any);

      expect(res.data[0].retryOutcome).toEqual({ status: 'SENT', at: later(2), error: null, deliveryStatus: 'DELIVERED' });
      expect(res.data[1].retryOutcome).toBeNull();
      expect(res.data[0].payload).toBeUndefined(); // large receipt data never goes to the list
    });
  });
});
