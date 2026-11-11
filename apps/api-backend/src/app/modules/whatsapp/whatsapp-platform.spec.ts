import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsAppAccountService } from './whatsapp-account.service';

const actor = { userId: 'u1', name: 'Admin', vendorId: 'x' } as never;
const A = 'acc-1';

const acct = (over: Record<string, unknown> = {}) => ({
  id: A, label: 'Lorem', wabaId: '1', phoneNumberId: '2', displayNumber: '+92', verifiedName: 'L', status: 'READY', qualityRating: 'GREEN',
  lastHealthCheckAt: null, lastHealthError: null, templateSuffix: null, templatesSyncedAt: null,
  tokenCipher: 'SECRET-CIPHER', tokenIv: 'SECRET-IV', tokenTag: 'SECRET-TAG', keyVersion: 7, accessToken: 'SECRET-ACCESS',
  vendors: [{ id: 'v1', name: 'V1', isActive: true }], ...over,
});

describe('WhatsAppAccountService platform operations', () => {
  let prisma: any;
  let audit: { log: jest.Mock };
  let provider: any;
  let service: WhatsAppAccountService;

  beforeEach(() => {
    prisma = {
      vendor: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      whatsAppAccount: { findUnique: jest.fn().mockResolvedValue(acct()), findMany: jest.fn().mockResolvedValue([acct()]), count: jest.fn().mockResolvedValue(1), update: jest.fn(), delete: jest.fn() },
    };
    provider = { fetchPhoneNumberInfo: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new WhatsAppAccountService(prisma, provider, audit as never, {} as never);
  });

  it('detailed list is an allow-list: no token material even if the row carries it', async () => {
    const res = await service.listAccountsDetailed({ page: 1, limit: 20, q: 'lor', status: 'READY' as any });
    const json = JSON.stringify(res);
    for (const s of ['tokenCipher', 'tokenIv', 'tokenTag', 'keyVersion', 'accessToken', 'SECRET']) expect(json).not.toContain(s);
    expect(res.data[0]).toMatchObject({ hasToken: true, vendorsCount: 1, vendors: [{ id: 'v1', name: 'V1', isActive: true }] });
    expect(res.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    expect(prisma.whatsAppAccount.findMany.mock.calls[0][0].where.status).toBe('READY');
  });

  it('assignableVendors only returns vendors without account, id+name, max 50', async () => {
    await service.assignableVendors('a');
    const a = prisma.vendor.findMany.mock.calls[0][0];
    expect(a.where.whatsappAccountId).toBeNull();
    expect(a.select).toEqual({ id: true, name: true });
    expect(a.take).toBe(50);
  });

  describe('assignVendor', () => {
    it('assigns, invalidates cache, audits ASSIGN', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v2', whatsappAccountId: null });
      const inv = jest.spyOn(service, 'invalidate');
      const r = await service.assignVendor(A, 'v2', {}, actor);
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v2' }, data: { whatsappAccountId: A } });
      expect(inv).toHaveBeenCalledWith('v2');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSIGN', entity: 'WhatsAppAccount', vendorId: 'v2', entityId: A }));
      expect(JSON.stringify(r)).not.toContain('SECRET');
    });
    it('409 VENDOR_HAS_ACCOUNT unless replace', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v2', whatsappAccountId: 'other' });
      const err: any = await service.assignVendor(A, 'v2', {}, actor).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().code).toBe('VENDOR_HAS_ACCOUNT');
      expect(prisma.vendor.update).not.toHaveBeenCalled();
      await service.assignVendor(A, 'v2', { replace: true }, actor);
      expect(prisma.vendor.update).toHaveBeenCalled();
      expect(audit.log.mock.calls[0][0].changes.before).toEqual({ accountId: 'other' });
    });
    it('404 for missing account or vendor', async () => {
      prisma.whatsAppAccount.findUnique.mockResolvedValueOnce(null);
      await expect(service.assignVendor(A, 'v2', {}, actor)).rejects.toBeInstanceOf(NotFoundException);
      prisma.vendor.findUnique.mockResolvedValue(null);
      await expect(service.assignVendor(A, 'v2', {}, actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unassignVendor', () => {
    it('detaches only that vendor, never deletes the account, audits UNASSIGN', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', whatsappAccountId: A });
      await service.unassignVendor(A, 'v1', actor);
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { whatsappAccountId: null } });
      expect(prisma.whatsAppAccount.delete).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UNASSIGN' }));
    });
    it('400 when the vendor is not on that account', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', whatsappAccountId: 'other' });
      await expect(service.unassignVendor(A, 'v1', actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.vendor.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyAccountById', () => {
    it('404 for unknown account', async () => {
      prisma.whatsAppAccount.findUnique.mockResolvedValueOnce(null);
      await expect(service.verifyAccountById(A, actor)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('provider network error keeps status (transient) and audits VERIFY', async () => {
      process.env['WHATSAPP_TOKEN_KEY'] = Buffer.alloc(32, 5).toString('base64');
      const { sealSecret } = await import('../../common/crypto/secret-box');
      const s = sealSecret('tok-1234567890-abcdefghij');
      prisma.whatsAppAccount.findUnique.mockResolvedValue(acct({ tokenCipher: s.cipher, tokenIv: s.iv, tokenTag: s.tag, keyVersion: s.keyVersion }));
      provider.fetchPhoneNumberInfo.mockResolvedValue({ ok: false, status: 503, message: 'network' });
      const r = await service.verifyAccountById(A, actor);
      expect(r.status).toBe('READY');
      expect(prisma.whatsAppAccount.update.mock.calls[0][0].data.status).toBeUndefined();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'VERIFY', entityId: A }));
    });
  });
});
