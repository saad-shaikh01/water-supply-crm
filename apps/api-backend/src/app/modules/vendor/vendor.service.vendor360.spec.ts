import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { VendorService, vendorSuspendedKey } from './vendor.service';
import type { AuthUser } from '@water-supply-crm/types';

const actor: AuthUser = { userId: 'sa1', email: 's@x.com', name: 'Super', role: 'SUPER_ADMIN' as never, vendorId: null as never, customerId: null };
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function build(over: { prisma?: any } = {}) {
  const prisma: any = {
    vendor: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      update: jest.fn(async ({ data }: any) => ({ id: 'v1', ...data })),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      update: jest.fn(),
      groupBy: jest.fn(async () => []),
    },
    customer: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0), aggregate: jest.fn(async () => ({ _sum: {} })) },
    route: { count: jest.fn(async () => 0) },
    van: { count: jest.fn(async () => 0) },
    transaction: { aggregate: jest.fn(async () => ({ _sum: {} })) },
    dailySheetItem: { count: jest.fn(async () => 0) },
    dailySheet: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
    ...over.prisma,
  };
  const cache = { set: jest.fn(), del: jest.fn() };
  const audit = { log: jest.fn(async () => undefined) };
  const auth = { revokeUserSessions: jest.fn(async () => undefined) };
  const provisioning = {};
  const svc = new VendorService(prisma, cache as never, audit as never, provisioning as never, auth as never);
  return { svc, prisma, cache, audit, auth };
}

describe('VendorService.update', () => {
  it('audits UPDATE with actor and changed fields only', async () => {
    const { svc, prisma, audit } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', name: 'Old', address: 'A', logoUrl: null, raastId: null });
    await svc.update('v1', { name: 'New', address: 'A' }, actor);
    expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { name: 'New' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', userId: 'sa1', userName: 'Super', changes: { before: { name: 'Old' }, after: { name: 'New' } } }),
    );
  });
  it('writes no audit and no update when nothing changed', async () => {
    const { svc, prisma, audit } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', name: 'Same', address: null, logoUrl: null, raastId: null });
    await svc.update('v1', { name: 'Same' }, actor);
    expect(prisma.vendor.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('404s a missing vendor', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValue(null);
    await expect(svc.update('x', { name: 'a' }, actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VendorService suspend / unsuspend', () => {
  it('suspend: DB flag, redis flag, audit SUSPEND with actor and reason', async () => {
    const { svc, prisma, cache, audit } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', name: 'V', isActive: true });
    await svc.suspend('v1', actor, 'non-payment');
    expect(prisma.vendor.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { isActive: false } });
    expect(cache.set).toHaveBeenCalledWith(vendorSuspendedKey('v1'), true, 0);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUSPEND', userId: 'sa1', userName: 'Super', changes: expect.objectContaining({ reason: 'non-payment' }) }),
    );
  });
  it('suspend: already suspended -> 409, missing -> 404', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValueOnce({ id: 'v1', name: 'V', isActive: false });
    await expect(svc.suspend('v1', actor)).rejects.toBeInstanceOf(ConflictException);
    prisma.vendor.findUnique.mockResolvedValueOnce(null);
    await expect(svc.suspend('v1', actor)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('unsuspend: clears redis flag, audit UNSUSPEND with actor; not suspended -> 409', async () => {
    const { svc, prisma, cache, audit } = build();
    prisma.vendor.findUnique.mockResolvedValueOnce({ id: 'v1', name: 'V', isActive: false });
    await svc.unsuspend('v1', actor);
    expect(cache.del).toHaveBeenCalledWith(vendorSuspendedKey('v1'));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UNSUSPEND', userId: 'sa1', userName: 'Super' }));
    prisma.vendor.findUnique.mockResolvedValueOnce({ id: 'v1', name: 'V', isActive: true });
    await expect(svc.unsuspend('v1', actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('remove: audit DELETE carries the actor', async () => {
    const { svc, prisma, audit } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1', name: 'V', _count: { transactions: 0, customers: 0 } });
    prisma.$transaction = jest.fn(async () => undefined);
    await svc.remove('v1', actor);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', userId: 'sa1', userName: 'Super' }));
  });
});

describe('VendorService.bulkSetSuspended', () => {
  it('returns per-id results for a mixed list', async () => {
    const { svc, prisma, audit } = build();
    prisma.vendor.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === UUID(1) ? { id: where.id, name: 'A', isActive: true } : where.id === UUID(2) ? { id: where.id, name: 'B', isActive: false } : null,
    );
    const r = await svc.bulkSetSuspended('suspend', [UUID(1), UUID(2), UUID(3)], actor, 'cleanup');
    expect(r.results.map((x) => x.ok)).toEqual([true, false, false]);
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.results[1].error).toMatch(/already suspended/);
    expect(r.results[2].error).toMatch(/not found/i);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
  it('skips protected (legacy) vendors', async () => {
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = UUID(9);
    try {
      const { svc, prisma } = build();
      const r = await svc.bulkSetSuspended('suspend', [UUID(9)], actor);
      expect(r.results[0]).toMatchObject({ ok: false });
      expect(prisma.vendor.findUnique).not.toHaveBeenCalled();
    } finally {
      delete process.env['WHATSAPP_ALLOWED_VENDOR_IDS'];
    }
  });
});

describe('VendorService.resetAdminPassword', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('SuperPass1', 4);
  });
  const dto = (over: object = {}) => ({ newPassword: 'NewPassw0rd', superAdminPassword: 'SuperPass1', reason: 'locked out', ...over });
  const withMe = (b: ReturnType<typeof build>) => {
    b.prisma.user.findUnique.mockResolvedValue({ password: hash, role: 'SUPER_ADMIN' });
    b.prisma.vendor.findUnique.mockResolvedValue({ id: 'v1' });
  };

  it('wrong super-admin password -> 403 and nothing updated', async () => {
    const b = build();
    withMe(b);
    await expect(b.svc.resetAdminPassword('v1', dto({ superAdminPassword: 'nope' }) as never, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.prisma.user.update).not.toHaveBeenCalled();
    expect(b.auth.revokeUserSessions).not.toHaveBeenCalled();
  });
  it('success: hashes the new password, revokes sessions, audits without any password material', async () => {
    const b = build();
    withMe(b);
    b.prisma.user.findMany.mockResolvedValue([{ id: 'ad1', email: 'a@v.com', name: 'Ad' }]);
    const r = await b.svc.resetAdminPassword('v1', dto() as never, actor);
    expect(r).toEqual({ message: expect.any(String), userId: 'ad1', email: 'a@v.com', sessionsRevoked: true });
    const written = b.prisma.user.update.mock.calls[0][0].data.password;
    expect(await bcrypt.compare('NewPassw0rd', written)).toBe(true);
    expect(b.auth.revokeUserSessions).toHaveBeenCalledWith('ad1');
    expect(b.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESET_ADMIN_PASSWORD', entity: 'User', entityId: 'ad1', vendorId: 'v1', userId: 'sa1', changes: expect.objectContaining({ reason: 'locked out' }) }),
    );
    const auditJson = JSON.stringify(b.audit.log.mock.calls);
    expect(auditJson).not.toContain('NewPassw0rd');
    expect(auditJson).not.toContain('SuperPass1');
    expect(auditJson).not.toContain(written);
  });
  it('several admins and no adminUserId -> 409 with the admin list', async () => {
    const b = build();
    withMe(b);
    b.prisma.user.findMany.mockResolvedValue([
      { id: 'a1', email: 'a1@v.com', name: 'A1' },
      { id: 'a2', email: 'a2@v.com', name: 'A2' },
    ]);
    const err: any = await b.svc.resetAdminPassword('v1', dto() as never, actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().admins).toHaveLength(2);
    expect(b.prisma.user.update).not.toHaveBeenCalled();
  });
  it('adminUserId from another vendor -> 404', async () => {
    const b = build();
    withMe(b);
    b.prisma.user.findFirst.mockResolvedValue(null);
    await expect(b.svc.resetAdminPassword('v1', dto({ adminUserId: UUID(5) }) as never, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(b.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: 'v1', role: 'VENDOR_ADMIN' }) }));
  });
  it('no active admin -> 404', async () => {
    const b = build();
    withMe(b);
    await expect(b.svc.resetAdminPassword('v1', dto() as never, actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VendorService.findAllPaginated', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: `V${i}`, users: [{ email: `a${i}@x.com` }] }));

  it('uses exactly one customer.groupBy and one user.groupBy for 20 rows (no per-row counts)', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findMany.mockResolvedValue(rows(20));
    prisma.vendor.count.mockResolvedValue(45);
    prisma.customer.groupBy.mockResolvedValue([{ vendorId: 'v3', _count: { _all: 7 } }]);
    prisma.user.groupBy.mockResolvedValue([{ vendorId: 'v3', _count: { _all: 2 } }]);
    const r = await svc.findAllPaginated({ page: 1, limit: 20 });
    expect(prisma.customer.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.user.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(r.data).toHaveLength(20);
    expect(r.data[3]).toMatchObject({ adminEmail: 'a3@x.com', _counts: { customers: 7, drivers: 2 } });
    expect(r.data[0]._counts).toEqual({ customers: 0, drivers: 0 });
    expect(r.meta).toMatchObject({ total: 45, page: 1, limit: 20, totalPages: 3 });
  });
  it('maps search / status / sort to where + orderBy', async () => {
    const { svc, prisma } = build();
    await svc.findAllPaginated({ search: 'acme', status: 'suspended', sort: 'name', order: 'asc', page: 2, limit: 10 });
    const arg = prisma.vendor.findMany.mock.calls[0][0];
    expect(arg.where.isActive).toBe(false);
    expect(arg.where.OR).toHaveLength(3);
    expect(arg.where.OR[0]).toEqual({ name: { contains: 'acme', mode: 'insensitive' } });
    expect(arg.orderBy).toEqual({ name: 'asc' });
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
  });
  it.each([
    ['active', { isActive: true }],
    ['live', { goLiveAt: { not: null } }],
    ['not_live', { goLiveAt: null }],
  ] as const)('status=%s filter', async (status, expected) => {
    const { svc, prisma } = build();
    await svc.findAllPaginated({ status });
    expect(prisma.vendor.findMany.mock.calls[0][0].where).toMatchObject(expected);
  });
  it('sort=customers orders by the counted customers', async () => {
    const { svc, prisma } = build();
    prisma.vendor.count.mockResolvedValue(3);
    prisma.vendor.findMany.mockImplementation(async ({ where, select }: any) =>
      select ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }] : (where.id.in as string[]).map((id) => ({ id, users: [] })),
    );
    prisma.customer.groupBy.mockResolvedValue([
      { vendorId: 'a', _count: { _all: 1 } },
      { vendorId: 'b', _count: { _all: 9 } },
      { vendorId: 'c', _count: { _all: 5 } },
    ]);
    const r = await svc.findAllPaginated({ sort: 'customers', order: 'desc', page: 1, limit: 2 });
    expect(r.data.map((v: any) => v.id)).toEqual(['b', 'c']);
    expect(r.data[0]._counts.customers).toBe(9);
  });
});

describe('VendorService.getStats', () => {
  it('computes the new fields; null aggregates become 0', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1' });
    prisma.user.count.mockImplementation(async ({ where }: any) => (where.role === 'CUSTOMER' ? 4 : where.isActive ? 6 : where.role ? 1 : 10));
    const r = await svc.getStats('v1');
    expect(r.stats).toMatchObject({ totalUsers: 10, customerUsers: 4, activeUsers: 6, inactiveUsers: 4, revenueThisMonth: 0, totalRevenue: 0, outstandingBalance: 0, lastActiveDate: null });
  });
  it('404s unknown vendor', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValue(null);
    await expect(svc.getStats('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VendorService.findVendorUsers', () => {
  it('always scopes to the vendor, excludes CUSTOMER by default, paginates, adds roleName and roleCounts', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValue({ id: 'v1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', role: 'VENDOR_ADMIN', roleRef: { name: 'Vendor Admin' } }, { id: 'u2', role: 'DRIVER', roleRef: null }]);
    prisma.user.count.mockResolvedValue(42);
    prisma.user.groupBy.mockResolvedValue([{ role: 'VENDOR_ADMIN', _count: { _all: 1 } }, { role: 'CUSTOMER', _count: { _all: 900 } }]);
    const r = await svc.findVendorUsers('v1', { page: 2, limit: 20 });
    const arg = prisma.user.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ vendorId: 'v1', role: { not: 'CUSTOMER' } });
    expect(arg.skip).toBe(20);
    expect(prisma.user.groupBy.mock.calls[0][0].where).toEqual({ vendorId: 'v1' });
    expect(r.data[0]).toMatchObject({ roleName: 'Vendor Admin' });
    expect(r.data[1]).toMatchObject({ roleName: null });
    expect(r.data[0]).not.toHaveProperty('roleRef');
    expect(r.meta).toMatchObject({ total: 42, page: 2, limit: 20, totalPages: 3, roleCounts: { VENDOR_ADMIN: 1, CUSTOMER: 900 } });
  });
  it('role / isActive / search filters; unknown vendor 404', async () => {
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValueOnce({ id: 'v1' });
    await svc.findVendorUsers('v1', { role: 'CUSTOMER', isActive: false, search: 'ali' });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ vendorId: 'v1', role: 'CUSTOMER', isActive: false });
    expect(where.OR).toHaveLength(3);
    prisma.vendor.findUnique.mockResolvedValueOnce(null);
    await expect(svc.findVendorUsers('zzz', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VendorService.create result (B8)', () => {
  it('returns { vendor, admin, provisioning.summary } without internal fields', async () => {
    const { svc, prisma, audit } = build();
    prisma.vendor.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    const tx = {
      vendor: { create: jest.fn(async () => ({ id: 'v9', name: 'N', slug: 's' })) },
      user: { create: jest.fn(async () => ({ id: 'u9', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN' })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
    (svc as any).provisioning = {
      provisionInTx: jest.fn(async () => ({
        rolesCreated: 5, driftGrantsAdded: 0, usersBackfilled: 0, customerFlagCategoriesSeeded: 3,
        backfilledUserIds: [], roleIdByKey: new Map([['vendor_admin', 'r1']]),
      })),
    };
    const r = await svc.create({ name: 'N', slug: 's', adminEmail: 'a@x.com', adminPassword: 'Passw0rd1', adminName: 'A' }, actor);
    expect(r.vendor).toMatchObject({ id: 'v9' });
    expect(r.admin).toEqual({ id: 'u9', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN' });
    expect(r.provisioning.summary).toEqual({ rolesCreated: 5, driftGrantsAdded: 0, usersBackfilled: 0, customerFlagCategoriesSeeded: 3 });
    expect(audit.log).toHaveBeenCalledTimes(2);
  });
  it('P2002 race -> ConflictException', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const { svc, prisma } = build();
    prisma.vendor.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    });
    await expect(svc.create({ name: 'N', slug: 's', adminEmail: 'a@x.com', adminPassword: 'Passw0rd1', adminName: 'A' }, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
