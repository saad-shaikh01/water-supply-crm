import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { openSecret, sealSecret } from '../../common/crypto/secret-box';
import { resetGateLogThrottle } from '../../common/tenant-gate/legacy-vendor-gate';

const ENV = [
  'WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS', 'WHATSAPP_TOKEN_KEY', 'WHATSAPP_TOKEN_KEY_VERSION',
  'META_WA_ACCESS_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'WHATSAPP_ENABLED',
] as const;
const KEY = Buffer.alloc(32, 5).toString('base64');
const actor = { userId: 'u1', name: 'Admin', vendorId: 'v-lorem' } as never;
const dto = { wabaId: '1000000000001', phoneNumberId: '2000000000002', accessToken: 'EAAB-valid-token-1234567890' };

const acctRow = (over: Record<string, unknown> = {}) => {
  const sealed = sealSecret('EAAB-stored-token');
  return {
    id: 'acc-1', label: 'Lorem', wabaId: '1', phoneNumberId: '2000000000002', displayNumber: '+92 300 1111111', verifiedName: 'Lorem',
    tokenCipher: sealed.cipher, tokenIv: sealed.iv, tokenTag: sealed.tag, keyVersion: sealed.keyVersion,
    status: 'READY', qualityRating: 'GREEN', lastHealthCheckAt: null, lastHealthError: null, templateSuffix: null, templatesSyncedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
};

describe('WhatsAppAccountService', () => {
  const saved: Record<string, string | undefined> = {};
  let prisma: any;
  let provider: { fetchPhoneNumberInfo: jest.Mock; isReady: jest.Mock; listTemplates: jest.Mock };
  let audit: { log: jest.Mock };
  let service: WhatsAppAccountService;

  beforeEach(() => {
    ENV.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    process.env['WHATSAPP_TOKEN_KEY'] = KEY;
    resetGateLogThrottle();
    prisma = {
      vendor: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
      whatsAppTemplate: { upsert: jest.fn((a: unknown) => a), deleteMany: jest.fn((a: unknown) => a) },
      whatsAppAccount: {
        findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => ({ id: 'acc-new', ...data })), update: jest.fn(async ({ data, where }: any) => ({ id: where.id, ...data })), delete: jest.fn().mockResolvedValue({}),
      },
    };
    provider = {
      isReady: jest.fn().mockReturnValue(true),
      fetchPhoneNumberInfo: jest.fn().mockResolvedValue({ ok: true, displayNumber: '+92 300 1111111', verifiedName: 'Lorem', qualityRating: 'GREEN' }),
      listTemplates: jest.fn().mockResolvedValue({ ok: true, templates: [] }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new WhatsAppAccountService(prisma, provider as never, audit as never, {} as never);
  });
  afterEach(() => {
    ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('routing', () => {
    it("uses the vendor's READY account (decrypted in memory) and caches the lookup", async () => {
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: acctRow() });
      const r = await service.routeFor('v-lorem', 'f');
      expect(r).toEqual({ source: 'ACCOUNT', accountId: 'acc-1', templateSuffix: null, creds: { phoneNumberId: '2000000000002', accessToken: 'EAAB-stored-token' } });
      await service.routeFor('v-lorem', 'f');
      expect(prisma.vendor.findUnique).toHaveBeenCalledTimes(1);
    });

    it('a vendor without an account falls back to the platform path only while the gate allows it (shadow/off/allow-list)', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: null });
      expect(await service.routeFor('v-x', 'f')).toEqual({ source: 'PLATFORM' }); // default shadow
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      expect(await service.routeFor('v-bi', 'f')).toEqual({ source: 'PLATFORM' });
      expect(await service.routeFor('v-x2', 'f')).toBeNull();
      expect(await service.routeFor(undefined, 'f')).toBeNull();
    });

    it('TOKEN_INVALID / NOT_CONFIGURED accounts are not used: Blue Ice degrades to the env path, others are blocked', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: acctRow({ status: 'TOKEN_INVALID' }) });
      expect(await service.routeFor('v-bi', 'f')).toEqual({ source: 'PLATFORM' });
      expect(await service.routeFor('v-lorem', 'f')).toBeNull();
    });

    it('an undecryptable stored token never throws into a send: same degradation, and it is not cached', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      const row = acctRow();
      process.env['WHATSAPP_TOKEN_KEY'] = Buffer.alloc(32, 6).toString('base64'); // key changed behind our back
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: row });
      expect(await service.routeFor('v-bi', 'f')).toEqual({ source: 'PLATFORM' });
      expect(await service.routeFor('v-lorem', 'f')).toBeNull();
      expect(prisma.vendor.findUnique).toHaveBeenCalledTimes(2); // retried, not cached as "no account"
    });

    it('a database error also degrades via the gate and never throws', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockRejectedValue(new Error('db down'));
      expect(await service.routeFor('v-bi', 'f')).toEqual({ source: 'PLATFORM' });
      expect(await service.routeFor('v-lorem', 'f')).toBeNull();
    });

    it('canSend is the side-effect-free twin', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: null });
      expect(await service.canSend('v-bi')).toBe(true);
      expect(await service.canSend('v-lorem')).toBe(false);
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: acctRow() });
      service.invalidate();
      expect(await service.canSend('v-lorem')).toBe(true);
    });
  });

  describe('go-live gate (enforce only)', () => {
    const notLive = (account: unknown = acctRow()) => ({ goLiveAt: null, whatsappAccount: account });

    it('a vendor that has not gone live sends nothing — even with a READY account — while the gate enforces', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockResolvedValue(notLive());
      expect(await service.routeFor('v-lorem', 'f')).toBeNull();
      expect(await service.canSend('v-lorem')).toBe(false);
    });

    it('after "Go live" the same vendor sends through its account', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      prisma.vendor.findUnique.mockResolvedValue({ goLiveAt: new Date(), whatsappAccount: acctRow() });
      expect((await service.routeFor('v-lorem', 'f'))?.source).toBe('ACCOUNT');
    });

    it('the default shadow mode ignores it (nothing changes until the gate is switched on)', async () => {
      prisma.vendor.findUnique.mockResolvedValue(notLive(null));
      expect(await service.routeFor('v-lorem', 'f')).toEqual({ source: 'PLATFORM' });
    });

    it('the legacy allow-list (Blue Ice) is never held back by it', async () => {
      process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-bi';
      prisma.vendor.findUnique.mockResolvedValue(notLive(null));
      expect(await service.routeFor('v-bi', 'f')).toEqual({ source: 'PLATFORM' });
    });
  });

  describe('connect', () => {
    beforeEach(() => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: null });
    });

    it('verifies with Meta FIRST, stores the token only encrypted, links the vendor and audits without the token', async () => {
      await service.connect('v-lorem', dto, actor);
      expect(provider.fetchPhoneNumberInfo).toHaveBeenCalledWith({ accessToken: dto.accessToken, phoneNumberId: dto.phoneNumberId });
      const saved = prisma.whatsAppAccount.create.mock.calls[0][0].data;
      expect(JSON.stringify(saved)).not.toContain(dto.accessToken);
      expect(openSecret({ cipher: saved.tokenCipher, iv: saved.tokenIv, tag: saved.tokenTag, keyVersion: saved.keyVersion })).toBe(dto.accessToken);
      expect(saved).toMatchObject({ label: 'Lorem', wabaId: dto.wabaId, phoneNumberId: dto.phoneNumberId, status: 'READY', displayNumber: '+92 300 1111111' });
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v-lorem' }, data: { whatsappAccountId: 'acc-new' } });
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain(dto.accessToken);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'v-lorem', entity: 'WhatsAppAccount', action: 'CREATE' }));
    });

    it('rejects credentials Meta refuses — nothing is stored', async () => {
      provider.fetchPhoneNumberInfo.mockResolvedValue({ ok: false, status: 401, code: 190, message: 'Invalid OAuth access token' });
      await expect(service.connect('v-lorem', dto, actor)).rejects.toThrow(/rejected these credentials \(code 190\)/);
      expect(prisma.whatsAppAccount.create).not.toHaveBeenCalled();
      expect(prisma.vendor.update).not.toHaveBeenCalled();
    });

    it('cannot store a token when the server has no encryption key', async () => {
      delete process.env['WHATSAPP_TOKEN_KEY'];
      await expect(service.connect('v-lorem', dto, actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(provider.fetchPhoneNumberInfo).not.toHaveBeenCalled();
    });

    it('a Phone Number ID already used by another account is a conflict (link it instead)', async () => {
      prisma.whatsAppAccount.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.connect('v-lorem', dto, actor)).rejects.toBeInstanceOf(ConflictException);
    });

    it('a vendor sharing a sender with sister brands cannot change it; the platform admin can', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow() });
      prisma.vendor.count.mockResolvedValue(1);
      await expect(service.connect('v-lorem', dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.connect('v-lorem', dto, actor, { isSuperAdmin: true })).resolves.toBeDefined();
      expect(prisma.whatsAppAccount.update).toHaveBeenCalled();
    });

    it('re-connecting updates the vendor’s own account in place', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow() });
      await service.connect('v-lorem', { ...dto, label: 'Lorem Main' }, actor);
      expect(prisma.whatsAppAccount.create).not.toHaveBeenCalled();
      expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'acc-1' }, data: expect.objectContaining({ label: 'Lorem Main', status: 'READY' }) }));
    });
  });

  describe('disconnect / link / import', () => {
    it('disconnecting a sole account deletes it (the token goes with the row); a shared one is only unlinked', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow() });
      await service.disconnect('v-lorem', actor);
      expect(prisma.whatsAppAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });

      prisma.whatsAppAccount.delete.mockClear();
      prisma.vendor.count.mockResolvedValue(2);
      await expect(service.disconnect('v-lorem', actor)).rejects.toBeInstanceOf(ForbiddenException);
      await service.disconnect('v-lorem', actor, { isSuperAdmin: true });
      expect(prisma.whatsAppAccount.delete).not.toHaveBeenCalled();
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v-lorem' }, data: { whatsappAccountId: null } });
    });

    it('links sister brands to one sender', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-dear', name: 'Dear', whatsappAccount: null });
      prisma.whatsAppAccount.findUnique.mockResolvedValue({ id: 'acc-1', phoneNumberId: '2000000000002' });
      await service.linkVendor('v-dear', 'acc-1', actor);
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v-dear' }, data: { whatsappAccountId: 'acc-1' } });
    });

    it('imports the platform env credentials as the vendor’s own account (Blue Ice env -> DB)', async () => {
      process.env['META_WA_ACCESS_TOKEN'] = 'EAAB-platform-token-123456';
      process.env['META_WA_PHONE_NUMBER_ID'] = '9990001112223';
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-bi', name: 'Blue Ice', whatsappAccount: null });
      await service.importPlatformCredentials('v-bi', actor);
      const saved = prisma.whatsAppAccount.create.mock.calls[0][0].data;
      expect(saved.phoneNumberId).toBe('9990001112223');
      expect(saved.label).toBe('Blue Ice');
      expect(JSON.stringify(saved)).not.toContain('EAAB-platform-token');
    });

    it('refuses to import when the platform has no credentials', async () => {
      await expect(service.importPlatformCredentials('v-bi', actor)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('health check', () => {
    it('marks a dead token TOKEN_INVALID (401 / code 190) but treats network errors as transient', async () => {
      prisma.whatsAppAccount.findMany.mockResolvedValue([acctRow({ id: 'a1', wabaId: null }), acctRow({ id: 'a2', wabaId: null }), acctRow({ id: 'a3', wabaId: null })]);
      provider.fetchPhoneNumberInfo
        .mockResolvedValueOnce({ ok: false, status: 401, code: 190, message: 'expired' })
        .mockResolvedValueOnce({ ok: false, status: 0, code: null, message: 'Timed out reaching WhatsApp' })
        .mockResolvedValueOnce({ ok: true, displayNumber: '+92', verifiedName: 'L', qualityRating: 'YELLOW' });
      const res = await service.runHealthCheck();
      expect(res).toEqual({ checked: 3, invalid: 1 });
      const updates = prisma.whatsAppAccount.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.status, c[0].data.lastHealthError]);
      expect(updates).toEqual([
        ['a1', 'TOKEN_INVALID', 'expired'],
        ['a2', undefined, 'Timed out reaching WhatsApp'], // status untouched
        ['a3', 'READY', null],
      ]);
    });

    it('a stored token that cannot be decrypted is TOKEN_INVALID, never a crash', async () => {
      const row = acctRow();
      process.env['WHATSAPP_TOKEN_KEY'] = Buffer.alloc(32, 8).toString('base64');
      prisma.whatsAppAccount.findMany.mockResolvedValue([row]);
      expect(await service.runHealthCheck()).toEqual({ checked: 1, invalid: 1 });
      expect(provider.fetchPhoneNumberInfo).not.toHaveBeenCalled();
    });

    it('a SUSPENDED account stays suspended even when Meta answers OK', async () => {
      prisma.whatsAppAccount.findMany.mockResolvedValue([acctRow({ status: 'SUSPENDED' })]);
      await service.runHealthCheck();
      expect(prisma.whatsAppAccount.update.mock.calls[0][0].data.status).toBe('SUSPENDED');
    });
  });

  describe('templates', () => {
    const vendorWith = (acct: Record<string, unknown> | null, brand: string | null = null) => ({
      id: 'v-lorem', name: 'Lorem Water', branding: brand ? { displayName: brand } : null, whatsappAccount: acct,
    });

    it('templateSendable: unknown before the first sync, then only APPROVED passes', async () => {
      prisma.whatsAppAccount.findUnique.mockResolvedValue({ templatesSyncedAt: null, templates: [] });
      expect(await service.templateSendable('acc-1', 'anything')).toBe(true);
      service.invalidate();
      prisma.whatsAppAccount.findUnique.mockResolvedValue({
        templatesSyncedAt: new Date(),
        templates: [{ name: 'balance_reminder', status: 'APPROVED' }, { name: 'delivery_receipt', status: 'PENDING' }],
      });
      expect(await service.templateSendable('acc-1', 'balance_reminder')).toBe(true);
      expect(await service.templateSendable('acc-1', 'delivery_receipt')).toBe(false); // not approved yet
      expect(await service.templateSendable('acc-1', 'order_approved')).toBe(false); // never created on Meta
    });

    it('a lookup failure never blocks a send', async () => {
      prisma.whatsAppAccount.findUnique.mockRejectedValue(new Error('db'));
      expect(await service.templateSendable('acc-1', 'x')).toBe(true);
    });

    it('the catalogue is rendered with the vendor’s OWN brand and carries each template’s status', async () => {
      prisma.vendor.findUnique.mockResolvedValue(
        vendorWith({
          id: 'acc-1', wabaId: '1000', templateSuffix: 'lorem', templatesSyncedAt: new Date(),
          templates: [{ name: 'delivery_receipt_lorem', status: 'APPROVED', rejectedReason: null }, { name: 'balance_reminder_lorem', status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' }],
        }, 'LOREM WATER'),
      );
      const view = await service.getTemplates('v-lorem');
      const receipt = view.items.find((i) => i.name === 'delivery_receipt')!;
      expect(receipt.finalName).toBe('delivery_receipt_lorem');
      expect(receipt.status).toBe('APPROVED');
      expect(receipt.body).toContain('Thank you for choosing LOREM WATER.');
      expect(view.items.find((i) => i.name === 'balance_reminder')).toMatchObject({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' });
      expect(view.items.find((i) => i.name === 'order_approved')!.status).toBe('NOT_FOUND');
      expect(JSON.stringify(view)).not.toMatch(/Blue Ice/);
      expect(view.approvedRequired).toBe(1);
    });

    it('before connecting / before a sync every template is UNKNOWN (not wrongly "missing")', async () => {
      prisma.vendor.findUnique.mockResolvedValue(vendorWith(null));
      expect((await service.getTemplates('v-lorem')).items.every((i) => i.status === 'UNKNOWN')).toBe(true);
    });

    it('sync mirrors Meta into the database (upserts, removes vanished templates, stamps the sync time)', async () => {
      const acct = acctRow({ wabaId: '1000' });
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acct, branding: null });
      provider.listTemplates.mockResolvedValue({
        ok: true,
        templates: [{ name: 'balance_reminder', language: 'en', category: 'UTILITY', status: 'APPROVED', rejectedReason: null }],
      });
      await service.syncVendorTemplates('v-lorem', actor);
      expect(provider.listTemplates).toHaveBeenCalledWith({ accessToken: 'EAAB-stored-token', phoneNumberId: '2000000000002' }, '1000');
      expect(prisma.whatsAppTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId_name_language: { accountId: 'acc-1', name: 'balance_reminder', language: 'en' } } }));
      expect(prisma.whatsAppTemplate.deleteMany).toHaveBeenCalledWith({ where: { accountId: 'acc-1', name: { notIn: ['balance_reminder'] } } });
      expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith({ where: { id: 'acc-1' }, data: { templatesSyncedAt: expect.any(Date) } });
    });

    it('sync explains itself when it cannot run (no account / no WABA id / Meta refuses)', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: null, branding: null });
      await expect(service.syncVendorTemplates('v-lorem', actor)).rejects.toThrow(/Connect a WhatsApp number/);
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow({ wabaId: null }), branding: null });
      await expect(service.syncVendorTemplates('v-lorem', actor)).rejects.toThrow(/Account ID is missing/);
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow({ wabaId: '1000' }), branding: null });
      provider.listTemplates.mockResolvedValue({ ok: false, status: 400, code: 100, message: 'Unsupported get request' });
      await expect(service.syncVendorTemplates('v-lorem', actor)).rejects.toThrow(/could not list templates \(code 100\)/);
    });

    it('two brands on one WABA cannot both use the plain names or the same suffix', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: null });
      prisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ label: 'Blue Ice' }); // suffix clash on this WABA
      await expect(service.connect('v-lorem', { ...dto, templateSuffix: undefined }, actor)).rejects.toBeInstanceOf(ConflictException);
      prisma.whatsAppAccount.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await service.connect('v-lorem', { ...dto, templateSuffix: 'lorem' }, actor);
      expect(prisma.whatsAppAccount.create.mock.calls.at(-1)[0].data.templateSuffix).toBe('lorem');
    });

    it('updateSettings: a shared sender is the platform admin’s to change', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', name: 'Lorem', whatsappAccount: acctRow({ wabaId: '1000' }) });
      prisma.vendor.count.mockResolvedValue(1);
      await expect(service.updateSettings('v-lorem', { templateSuffix: 'lorem' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
      await service.updateSettings('v-lorem', { templateSuffix: 'lorem' }, actor, { isSuperAdmin: true });
      expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith({ where: { id: 'acc-1' }, data: { templateSuffix: 'lorem' } });
    });
  });

  describe('view', () => {
    it('never exposes the token; shows who shares the sender only to the platform admin', async () => {
      process.env['WHATSAPP_ENABLED'] = 'true';
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', whatsappAccount: acctRow() });
      prisma.vendor.findMany.mockResolvedValue([{ id: 'v-dear', name: 'Dear' }]);
      const vendorView = await service.getView('v-lorem');
      const adminView = await service.getView('v-lorem', { isSuperAdmin: true });
      expect(JSON.stringify(vendorView)).not.toMatch(/tokenCipher|tokenIv|tokenTag|EAAB/);
      expect(vendorView.account).toMatchObject({ hasToken: true, sharedCount: 1, sharedWith: [] });
      expect(vendorView.canEdit).toBe(false);
      expect(adminView.account?.sharedWith).toEqual([{ id: 'v-dear', name: 'Dear' }]);
      expect(adminView.canEdit).toBe(true);
      expect(vendorView.sending).toEqual({ allowed: true, via: 'ACCOUNT' });
    });

    it('reports "not sending" when the platform master switch is off', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v-lorem', whatsappAccount: acctRow() });
      expect((await service.getView('v-lorem')).sending).toEqual({ allowed: false, via: 'NONE' });
    });
  });
});
