import { VendorService } from './vendor.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';

function makeService(vendor: unknown) {
  const prisma = { vendor: { findUnique: jest.fn(async () => vendor) } };
  // Only prisma is exercised by findOne.
  return new VendorService(prisma as never, {} as never, {} as never, {} as never);
}

const superAdmin: AuthUser = {
  userId: 's', email: 's@x.com', name: 'Super', role: 'SUPER_ADMIN' as never, vendorId: null as never, customerId: null,
};
const vendorAdmin = (vendorId: string): AuthUser => ({
  userId: 'a', email: 'a@x.com', name: 'VA', role: 'VENDOR_ADMIN' as never, vendorId, customerId: null,
});

describe('VendorService.findOne tenant scoping (C5 cross-tenant fix)', () => {
  it('SUPER_ADMIN can read any vendor', async () => {
    const svc = makeService({ id: 'v2', name: 'Other' });
    await expect(svc.findOne('v2', superAdmin)).resolves.toEqual({ id: 'v2', name: 'Other' });
  });

  it('VENDOR_ADMIN can read their OWN vendor', async () => {
    const svc = makeService({ id: 'v1', name: 'Mine' });
    await expect(svc.findOne('v1', vendorAdmin('v1'))).resolves.toEqual({ id: 'v1', name: 'Mine' });
  });

  it('VENDOR_ADMIN CANNOT read another vendor', async () => {
    const svc = makeService({ id: 'v2', name: 'Other' });
    await expect(svc.findOne('v2', vendorAdmin('v1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still 404s a missing vendor for an authorized caller', async () => {
    const svc = makeService(null);
    await expect(svc.findOne('v1', vendorAdmin('v1'))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VendorService invalidates the platform dashboard cache', () => {
  const vendor = (isActive: boolean) => ({ id: 'v1', name: 'V', slug: 'v', isActive, _count: { transactions: 0, customers: 0 } });

  function build(isActive: boolean) {
    const tx: any = {
      vendor: { create: jest.fn(async () => ({ id: 'v1', name: 'V', slug: 'v' })), delete: jest.fn(), update: jest.fn() },
      user: { create: jest.fn(async () => ({ id: 'u1', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN' })), deleteMany: jest.fn() },
    };
    for (const m of ['dailySheetItem', 'dailySheet', 'bottleWallet', 'customerProductPrice', 'customer', 'van', 'route', 'product', 'customerFlagCategory']) {
      tx[m] = { deleteMany: jest.fn() };
    }
    const prisma = {
      vendor: {
        findUnique: jest.fn(async (args: any) => (args.where.slug ? null : vendor(isActive))),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const cache = { set: jest.fn(), del: jest.fn(), invalidatePlatformDashboard: jest.fn(async () => undefined) };
    const audit = { log: jest.fn() };
    const provisioning = { provisionInTx: jest.fn(async () => ({ roleIdByKey: new Map() })) };
    const svc = new VendorService(prisma as never, cache as never, audit as never, provisioning as never);
    return { svc, cache };
  }

  it('create', async () => {
    const { svc, cache } = build(true);
    await svc.create({ name: 'V', slug: 'v', adminEmail: 'a@x.com', adminPassword: 'Passw0rd!', adminName: 'A' } as never);
    expect(cache.invalidatePlatformDashboard).toHaveBeenCalledTimes(1);
  });
  it('suspend', async () => {
    const { svc, cache } = build(true);
    await svc.suspend('v1');
    expect(cache.invalidatePlatformDashboard).toHaveBeenCalledTimes(1);
  });
  it('unsuspend', async () => {
    const { svc, cache } = build(false);
    await svc.unsuspend('v1');
    expect(cache.invalidatePlatformDashboard).toHaveBeenCalledTimes(1);
  });
  it('remove', async () => {
    const { svc, cache } = build(true);
    await svc.remove('v1');
    expect(cache.invalidatePlatformDashboard).toHaveBeenCalledTimes(1);
  });
  it('does not invalidate when suspend fails (already suspended)', async () => {
    const { svc, cache } = build(false);
    await expect(svc.suspend('v1')).rejects.toThrow();
    expect(cache.invalidatePlatformDashboard).not.toHaveBeenCalled();
  });
});
