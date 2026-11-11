import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** Audit M1: `GET /audit-logs/:id` returned any vendor's log (before/after JSON included) by id alone. */
const user = (role: UserRole, vendorId: string | null): AuthUser => ({
  userId: 'u',
  email: 'u@x.test',
  name: 'U',
  role: role as never,
  vendorId: vendorId as never,
  customerId: null,
});

function setup() {
  const rows = [
    { id: 'log-a', vendorId: 'vendor-a', entity: 'Customer', changes: { after: { name: 'A secret' } } },
    { id: 'log-b', vendorId: 'vendor-b', entity: 'Customer', changes: { after: { name: 'B secret' } } },
  ];
  // honours the vendorId filter, like Postgres would
  const prisma = {
    auditLog: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.id === where.id && (where.vendorId === undefined || r.vendorId === where.vendorId)) ?? null,
      ),
    },
  };
  const controller = new AuditController(new AuditService(prisma as never));
  return { controller, prisma };
}

describe('GET /audit-logs/:id tenant scoping', () => {
  it('a vendor admin reads their own log', async () => {
    const { controller } = setup();
    await expect(controller.findOne(user(UserRole.VENDOR_ADMIN, 'vendor-a'), 'log-a')).resolves.toMatchObject({ id: 'log-a' });
  });

  it('a vendor admin gets 404 for ANOTHER vendor\'s log (and never sees its content)', async () => {
    const { controller } = setup();
    await expect(controller.findOne(user(UserRole.VENDOR_ADMIN, 'vendor-a'), 'log-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('the query itself carries the caller\'s vendorId', async () => {
    const { controller, prisma } = setup();
    await controller.findOne(user(UserRole.VENDOR_ADMIN, 'vendor-a'), 'log-a');
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({ where: { id: 'log-a', vendorId: 'vendor-a' } });
  });

  it('a platform SUPER_ADMIN can still read any vendor\'s log', async () => {
    const { controller } = setup();
    await expect(controller.findOne(user(UserRole.SUPER_ADMIN, null), 'log-b')).resolves.toMatchObject({ id: 'log-b' });
  });
});

describe('GET /audit-logs vendorId / entities filters (P2 B7)', () => {
  function listSetup() {
    const prisma = { auditLog: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) } };
    return { controller: new AuditController(new AuditService(prisma as never)), prisma };
  }
  const whereOf = (prisma: any) => prisma.auditLog.findMany.mock.calls[0][0].where;

  it('a vendor admin passing a foreign vendorId still only sees their own vendor', async () => {
    const { controller, prisma } = listSetup();
    await controller.findAll(user(UserRole.VENDOR_ADMIN, 'vendor-a'), { vendorId: 'vendor-b' } as never);
    expect(whereOf(prisma).vendorId).toBe('vendor-a');
  });

  it('SUPER_ADMIN may filter by vendorId', async () => {
    const { controller, prisma } = listSetup();
    await controller.findAll(user(UserRole.SUPER_ADMIN, null), { vendorId: 'vendor-b' } as never);
    expect(whereOf(prisma).vendorId).toBe('vendor-b');
  });

  it('SUPER_ADMIN without vendorId sees all vendors', async () => {
    const { controller, prisma } = listSetup();
    await controller.findAll(user(UserRole.SUPER_ADMIN, null), {} as never);
    expect(whereOf(prisma).vendorId).toBeUndefined();
  });

  it('entities comma list becomes an IN filter; entity wins if both given', async () => {
    const { controller, prisma } = listSetup();
    await controller.findAll(user(UserRole.SUPER_ADMIN, null), { entities: 'Vendor, User ,VendorBranding' } as never);
    expect(whereOf(prisma).entity).toEqual({ in: ['Vendor', 'User', 'VendorBranding'] });
    prisma.auditLog.findMany.mockClear();
    await controller.findAll(user(UserRole.SUPER_ADMIN, null), { entity: 'Vendor', entities: 'User' } as never);
    expect(whereOf(prisma).entity).toBe('Vendor');
  });
});
