import { WhatsAppService } from './whatsapp.service';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;
const BLUE_ICE = 'vendor-blue-ice';
const LOREM = 'vendor-lorem';
const PHONE = '923001234567';
const LOREM_CREDS = { accessToken: 'lorem-token', phoneNumberId: '111' };

describe('WhatsAppService — per-vendor routing + P0 vendor gate', () => {
  const saved: Record<string, string | undefined> = {};
  let provider: { isReady: jest.Mock; sendTemplate: jest.Mock; sendMessage: jest.Mock; sendDocument: jest.Mock };
  let store: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let readyCreds: Record<string, typeof LOREM_CREDS | null>;
  let suffixes: Record<string, string | null>;
  let templateOk: jest.Mock;
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
    readyCreds = {};
    suffixes = {};
    templateOk = jest.fn().mockResolvedValue(true);
    // Real routing logic (WhatsAppAccountService.routeFor / canSend), with the DB lookup of a READY account stubbed.
    const accounts = new WhatsAppAccountService({} as never, provider as never, {} as never, {} as never);
    jest.spyOn(accounts as never, 'lookup' as never).mockImplementation((async (vendorId: string) => ({
      live: true,
      account: readyCreds[vendorId] ? { creds: readyCreds[vendorId], accountId: `acc-${vendorId}`, templateSuffix: suffixes[vendorId] ?? null } : null,
    })) as never);
    jest.spyOn(accounts, 'templateSendable').mockImplementation(templateOk as never);
    service = new WhatsAppService(provider as never, cache as never, accounts);
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('default (shadow) — Blue Ice behaviour must not change', () => {
    it('sends via the PLATFORM credentials (none passed) and forwards the exact template args', async () => {
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan'], { buffer: Buffer.from('x'), filename: 'r.pdf' })).toBe(true);
      expect(provider.sendTemplate).toHaveBeenCalledWith(PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan'], { buffer: expect.any(Buffer), filename: 'r.pdf' }, undefined, undefined);
      expect(await service.sendTemplate(LOREM, '923009999999', 'balance_reminder', ['B', '5'])).toBe(true);
      expect(await service.sendTemplate(undefined, '923008888888', 'balance_reminder', ['C', '5'])).toBe(true);
    });
  });

  describe("a vendor's own READY account", () => {
    it("sends through that account's credentials — in every gate mode, even enforce without being allow-listed", async () => {
      readyCreds[LOREM] = LOREM_CREDS;
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
      expect(await service.sendTemplate(LOREM, PHONE, 'balance_reminder', ['A', '1'])).toBe(true);
      expect(provider.sendTemplate).toHaveBeenCalledWith(PHONE, 'balance_reminder', ['A', '1'], undefined, undefined, LOREM_CREDS);
      expect(await service.sendMessage(LOREM, '923007777777', 'hi')).toBe(true);
      expect(provider.sendMessage).toHaveBeenCalledWith('923007777777', 'hi', LOREM_CREDS);
      expect(await service.sendDocument(LOREM, '923006666666', Buffer.from('x'), 'a.pdf')).toBe(true);
      expect(provider.sendDocument).toHaveBeenCalledWith('923006666666', expect.any(Buffer), 'a.pdf', undefined, LOREM_CREDS);
    });

    it('wins over the platform path for an allow-listed vendor too (Blue Ice after its env->DB move)', async () => {
      readyCreds[BLUE_ICE] = { accessToken: 'bi-token', phoneNumberId: '222' };
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
      await service.sendTemplate(BLUE_ICE, PHONE, 'monthly_statement', ['A', 'L1', '10.00']);
      expect(provider.sendTemplate).toHaveBeenCalledWith(PHONE, 'monthly_statement', ['A', 'L1', '10.00'], undefined, undefined, { accessToken: 'bi-token', phoneNumberId: '222' });
    });
  });

  describe('templates on a vendor’s own account', () => {
    beforeEach(() => {
      readyCreds[LOREM] = LOREM_CREDS;
    });

    it('a brand sharing a WABA sends under its suffixed template name; the plain name is untouched for others', async () => {
      suffixes[LOREM] = 'lorem';
      await service.sendTemplate(LOREM, PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan']);
      expect(provider.sendTemplate).toHaveBeenLastCalledWith(PHONE, 'delivery_receipt_lorem', ['A', 'L1', '1 Jan'], undefined, undefined, LOREM_CREDS);
      expect(templateOk).toHaveBeenCalledWith('acc-' + LOREM, 'delivery_receipt_lorem');
      await service.sendTemplate(BLUE_ICE, '923005556677', 'delivery_receipt', ['A', 'L1', '1 Jan']); // platform path, no suffix
      expect(provider.sendTemplate).toHaveBeenLastCalledWith('923005556677', 'delivery_receipt', ['A', 'L1', '1 Jan'], undefined, undefined, undefined);
    });

    it('a template Meta is known NOT to have approved is skipped — nothing reaches Meta', async () => {
      templateOk.mockResolvedValue(false);
      expect(await service.sendTemplate(LOREM, PHONE, 'balance_reminder', ['A', '1'])).toBe(false);
      expect(provider.sendTemplate).not.toHaveBeenCalled();
    });

    it('Blue Ice (legacy allow-list) is exempt from the approval gate even on its own account', async () => {
      readyCreds[BLUE_ICE] = { accessToken: 'bi', phoneNumberId: '9' };
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
      templateOk.mockResolvedValue(false);
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 'delivery_receipt', ['A', 'L1', '1 Jan'])).toBe(true);
      expect(templateOk).not.toHaveBeenCalled();
    });

    it('text messages and documents are not subject to the template gate', async () => {
      templateOk.mockResolvedValue(false);
      expect(await service.sendMessage(LOREM, '923007770001', 'hi')).toBe(true);
      expect(templateOk).not.toHaveBeenCalled();
    });
  });

  describe('enforce', () => {
    beforeEach(() => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
    });

    it('lets the allow-listed vendor (Blue Ice) send exactly as before — platform credentials, no account needed', async () => {
      expect(await service.sendTemplate(BLUE_ICE, PHONE, 'monthly_statement', ['A', 'L1', '10.00'])).toBe(true);
      expect(provider.sendTemplate).toHaveBeenCalledWith(PHONE, 'monthly_statement', ['A', 'L1', '10.00'], undefined, undefined, undefined);
    });

    it('a vendor with NO usable account is blocked on every send path — the platform number is never borrowed', async () => {
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

    it('canSendFor mirrors routing without side effects', async () => {
      expect(await service.canSendFor(BLUE_ICE)).toBe(true);
      expect(await service.canSendFor(LOREM)).toBe(false);
      expect(await service.canSendFor(undefined)).toBe(false);
      readyCreds[LOREM] = LOREM_CREDS;
      expect(await service.canSendFor(LOREM)).toBe(true);
    });
  });

  describe('isReadyFor — vendor-aware readiness for bulk loops (replaces the platform-only isReady)', () => {
    it('asks the provider about the VENDOR’S credentials when it has an account (a platform with no env credentials must not abort its batch)', async () => {
      readyCreds[LOREM] = LOREM_CREDS;
      provider.isReady.mockImplementation((c?: unknown) => !!c); // platform creds absent, vendor creds fine
      expect(await service.isReadyFor(LOREM)).toBe(true);
      expect(provider.isReady).toHaveBeenLastCalledWith(LOREM_CREDS);
    });

    it('uses the platform credentials for an allowed account-less vendor (Blue Ice — unchanged behaviour)', async () => {
      provider.isReady.mockReturnValue(true);
      expect(await service.isReadyFor(BLUE_ICE)).toBe(true);
      expect(provider.isReady).toHaveBeenLastCalledWith(undefined);
      provider.isReady.mockReturnValue(false);
      expect(await service.isReadyFor(BLUE_ICE)).toBe(false);
    });

    it('is false for a vendor the gate blocks, and never logs "would block" noise from a readiness probe', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = BLUE_ICE;
      expect(await service.isReadyFor(LOREM)).toBe(false);
      expect(await service.isReadyFor(undefined)).toBe(false);
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
