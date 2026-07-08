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
