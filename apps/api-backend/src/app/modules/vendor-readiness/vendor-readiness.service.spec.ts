import { ConflictException, NotFoundException } from '@nestjs/common';
import { VendorReadinessService } from './vendor-readiness.service';

const actor = { userId: 'u1', name: 'Admin', vendorId: 'v1' } as never;

const branding = (over: Record<string, unknown> = {}) => ({
  displayName: 'Lorem Water',
  address: 'Lahore',
  phones: '0300',
  paymentAccounts: [{ kind: 'BANK', accountTitle: 'L', bankName: 'HBL', accountNumber: '1234-5678' }],
  ...over,
});

describe('VendorReadinessService', () => {
  let prisma: any;
  let accounts: { getView: jest.Mock; getTemplates: jest.Mock; invalidate: jest.Mock };
  let audit: { log: jest.Mock };
  let service: VendorReadinessService;
  let counts: { products: number; vans: number; routes: number; customers: number };
  let wa: any;
  let tpl: any;

  beforeEach(() => {
    counts = { products: 2, vans: 1, routes: 1, customers: 10 };
    prisma = {
      vendor: { findUnique: jest.fn(async () => ({ id: 'v1', name: 'Lorem', goLiveAt: null })), update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
      vendorBranding: { findUnique: jest.fn(async () => branding()) },
      product: { count: jest.fn(async () => counts.products) },
      van: { count: jest.fn(async () => counts.vans) },
      route: { count: jest.fn(async () => counts.routes) },
      customer: { count: jest.fn(async () => counts.customers) },
    };
    wa = { account: { status: 'READY', displayNumber: '+92 300 1111111' } };
    tpl = { hasAccount: true, syncedAt: new Date(), approvedRequired: 14, totalRequired: 14 };
    accounts = {
      getView: jest.fn(async () => wa),
      getTemplates: jest.fn(async () => tpl),
      invalidate: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new VendorReadinessService(prisma, accounts as never, audit as never);
  });

  const status = async (key: string) => (await service.get('v1')).items.find((i) => i.key === key)!.status;

  it('a fully set-up vendor is ready (and still not live until it presses the button)', async () => {
    const r = await service.get('v1');
    expect(r.ready).toBe(true);
    expect(r.live).toBe(false);
    expect(r.items.filter((i) => i.required).every((i) => i.status === 'DONE')).toBe(true);
  });

  it('company profile and payment accounts are checked separately', async () => {
    prisma.vendorBranding.findUnique.mockResolvedValue(branding({ address: '', paymentAccounts: [] }));
    const r = await service.get('v1');
    expect(r.items.find((i) => i.key === 'company_profile')).toMatchObject({ status: 'TODO', detail: 'Missing: address.' });
    expect(r.items.find((i) => i.key === 'payment_accounts')!.status).toBe('TODO');
    expect(r.ready).toBe(false);
  });

  it('no profile at all => both TODO', async () => {
    prisma.vendorBranding.findUnique.mockResolvedValue(null);
    expect(await status('company_profile')).toBe('TODO');
    expect(await status('payment_accounts')).toBe('TODO');
  });

  it('products are required; vans/routes and customers are only recommended', async () => {
    counts = { products: 0, vans: 0, routes: 0, customers: 0 };
    const r = await service.get('v1');
    expect(r.items.find((i) => i.key === 'products')).toMatchObject({ required: true, status: 'TODO' });
    expect(r.items.find((i) => i.key === 'vans_routes')).toMatchObject({ required: false, status: 'WARN' });
    expect(r.items.find((i) => i.key === 'customers')).toMatchObject({ required: false, status: 'WARN' });
    counts = { products: 1, vans: 0, routes: 0, customers: 0 };
    expect((await service.get('v1')).ready).toBe(true); // optional items never block go-live
  });

  it('WhatsApp must be connected on the vendor’s OWN account; a broken or missing connection is TODO', async () => {
    wa.account = { status: 'TOKEN_INVALID', displayNumber: null };
    expect(await status('whatsapp_connected')).toBe('TODO');
    wa.account = null;
    expect(await status('whatsapp_connected')).toBe('TODO');
  });

  it('templates: needs a sync and every required template approved', async () => {
    tpl = { hasAccount: true, syncedAt: null, approvedRequired: 0, totalRequired: 14 };
    expect(await status('whatsapp_templates')).toBe('TODO');
    tpl = { hasAccount: true, syncedAt: new Date(), approvedRequired: 13, totalRequired: 14 };
    const item = (await service.get('v1')).items.find((i) => i.key === 'whatsapp_templates')!;
    expect(item).toMatchObject({ status: 'TODO', detail: '13 of 14 required templates approved.' });
    tpl = { hasAccount: false, syncedAt: null, approvedRequired: 0, totalRequired: 14 };
    expect(await status('whatsapp_templates')).toBe('TODO');
  });

  describe('go live', () => {
    it('sets goLiveAt, busts the routing cache and audits', async () => {
      prisma.vendor.findUnique
        .mockResolvedValueOnce({ id: 'v1', name: 'Lorem', goLiveAt: null })
        .mockResolvedValue({ id: 'v1', name: 'Lorem', goLiveAt: new Date() });
      const r = await service.goLive('v1', actor);
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { goLiveAt: expect.any(Date) } });
      expect(accounts.invalidate).toHaveBeenCalledWith('v1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GO_LIVE', entity: 'Vendor', vendorId: 'v1' }));
      expect(r.live).toBe(true);
    });

    it('is refused while a required item is open, naming what is open', async () => {
      counts.products = 0;
      await expect(service.goLive('v1', actor)).rejects.toMatchObject({ response: { open: ['products'] } });
      await expect(service.goLive('v1', actor)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vendor.update).not.toHaveBeenCalled();
    });

    it('the platform admin can force it, and the audit says so', async () => {
      counts.products = 0;
      prisma.vendor.findUnique.mockResolvedValueOnce({ id: 'v1', name: 'Lorem', goLiveAt: null }).mockResolvedValue({ id: 'v1', name: 'Lorem', goLiveAt: new Date() });
      await service.goLive('v1', actor, { force: true });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ changes: { after: { goLiveAt: 'now', forced: true } } }));
    });

    it('is idempotent for a vendor that is already live', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', name: 'Lorem', goLiveAt: new Date() });
      counts.products = 0; // even with open items — already live stays live
      const r = await service.goLive('v1', actor);
      expect(r.live).toBe(true);
      expect(prisma.vendor.update).not.toHaveBeenCalled();
    });

    it('go offline clears goLiveAt', async () => {
      await service.goOffline('v1', actor);
      expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { goLiveAt: null } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GO_OFFLINE' }));
    });

    it('unknown vendor => 404', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('overview lists every active vendor with its progress', async () => {
    counts.products = 0;
    const rows = await service.overview();
    expect(rows).toEqual([{ vendor: { id: 'v1', name: 'Lorem' }, live: false, ready: false, requiredDone: 4, requiredTotal: 5, open: ['products'] }]);
  });
});
