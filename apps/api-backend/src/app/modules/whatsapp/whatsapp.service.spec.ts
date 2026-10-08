import { WhatsAppService } from './whatsapp.service';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;
const BLUE_ICE = 'vendor-blue-ice';
const LOREM = 'vendor-lorem';
const PHONE = '923001234567';

describe('WhatsAppService — P0 vendor gate', () => {
  const saved: Record<string, string | undefined> = {};
  let provider: { isReady: jest.Mock; sendTemplate: jest.Mock; sendMessage: jest.Mock; sendDocument: jest.Mock };
  let store: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: WhatsAppService;

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    resetGateLogThrottle();
    provider = {
      isReady: jest.fn().mockReturnValue(true),
      sendTemplate: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(true),
      sendDocument: jest.fn().mockResolvedValue(true),
    };
    store = new Map();
    cache = {
      get: jest.fn(async (k: string) => store.get(k)),
      set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    };
    service = new WhatsAppService(provider as any, cache as any);
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('default (shadow) — Blue Ice behaviour must not change', () => {
    it('sends for every vendor and passes the exact template args to the provider', async () => {
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan'], { buffer: Buffer.from('x'), filename: 'r.pdf' })).toBe(true);
      expect(provider.sendTemplate).toHaveBeenCalledWith(PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan'], { buffer: expect.any(Buffer), filename: 'r.pdf' }, undefined);
      expect(await service.sendTemplate(LOREM, '923009999999', 'balance_reminder', ['B', '5'])).toBe(true);
      expect(await service.sendTemplate(undefined, '923008888888', 'balance_reminder', ['C', '5'])).toBe(true);
    });
  });

  describe('enforce', () => {
    beforeEach(() => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
    });

    it('lets the allow-listed vendor (Blue Ice) send exactly as before', async () => {
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 'monthly_statement', ['A', 'L1', '10.00'])).toBe(true);
      expect(provider.sendTemplate).toHaveBeenCalledTimes(1);
    });

    it('blocks every other vendor on every send path — provider is never called', async () => {
      expect(await service.sendTemplate(LOREM, PHONE, 'balance_reminder', ['A', '1'])).toBe(false);
      expect(await service.sendMessage(LOREM, PHONE, 'hi')).toBe(false);
      expect(await service.sendDocument(LOREM, PHONE, Buffer.from('x'), 'a.pdf')).toBe(false);
      expect(provider.sendTemplate).not.toHaveBeenCalled();
      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(provider.sendDocument).not.toHaveBeenCalled();
    });

    it('is fail-closed for a missing vendorId', async () => {
      expect(await service.sendTemplate(undefined, PHONE, 'balance_reminder', ['A', '1'])).toBe(false);
      expect(await service.sendTemplate(null, PHONE, 'balance_reminder', ['A', '1'])).toBe(false);
      expect(provider.sendTemplate).not.toHaveBeenCalled();
    });

    it('isBlockedForVendor mirrors the gate without side effects', () => {
      expect(service.isBlockedForVendor(BLUE_ICE)).toBe(false);
      expect(service.isBlockedForVendor(LOREM)).toBe(true);
      expect(service.isBlockedForVendor(undefined)).toBe(true);
    });
  });

  describe('rate limit is per vendor + phone (B3)', () => {
    it('a send by one vendor does not silence another vendor to the same phone, but still limits the same vendor', async () => {
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 't', ['a'])).toBe(true);
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 't', ['a'])).toBe(false); // same vendor+phone within 60s
      expect(await service.sendTemplate(LOREM, PHONE, 't', ['a'])).toBe(true); // different vendor, same phone
      expect(provider.sendTemplate).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores empty phone / template without touching the provider', async () => {
    expect(await service.sendTemplate(BLUE_ICE, '', 't', [])).toBe(false);
    expect(await service.sendTemplate(BLUE_ICE, PHONE, '', [])).toBe(false);
    expect(provider.sendTemplate).not.toHaveBeenCalled();
  });
});
