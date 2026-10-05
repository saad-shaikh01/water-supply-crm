import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { UserRole } from '@prisma/client';
import { VENDOR_ROLE_KEYS } from '@water-supply-crm/authz';
import { VendorService } from './vendor.service';
import { VendorProvisioningService, DEFAULT_CUSTOMER_FLAG_CATEGORIES } from './vendor-provisioning.service';

/**
 * Real-database integration test for new-vendor onboarding (multi-vendor roadmap step 1).
 *
 * Unit tests with a mocked Prisma cannot catch the bug this feature fixed: vendor creation
 * wrote the vendor on a transaction client but the admin user on the global client, which
 * cannot see the uncommitted vendor row (FK `User_vendorId_fkey`). Only a real Postgres does.
 *
 * Opt-in: set TEST_DATABASE_URL to a THROWAWAY database whose schema is already applied
 * (`prisma db push`). It never falls back to DATABASE_URL — this suite creates and deletes
 * vendors and must not be pointed at a dev/prod database by accident.
 *
 *   TEST_DATABASE_URL=postgresql://... npx jest -c jest.config.cts vendor-provisioning.integration
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(60000);

describeDb('Vendor onboarding (real Postgres)', () => {
  const RUN = randomUUID().slice(0, 8);
  const prisma = new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const invalidated: string[] = [];
  const permissions = { invalidateUsers: jest.fn(async (ids: string[]) => void invalidated.push(...ids)) };
  const audit = { log: jest.fn(async () => undefined) };
  const cache = { del: jest.fn(), set: jest.fn() };

  const provisioning = new VendorProvisioningService(prisma, permissions as never, audit as never);
  const service = new VendorService(prisma, cache as never, audit as never, provisioning);

  const dto = (tag: string) => ({
    name: `Test ${tag}`,
    slug: `t-${RUN}-${tag}`,
    adminEmail: `admin-${RUN}-${tag}@example.test`,
    adminPassword: 'Password123!',
    adminName: `Admin ${tag}`,
  });

  const createdVendorIds: string[] = [];
  const track = async (tag: string) => {
    const v = await service.create(dto(tag));
    createdVendorIds.push(v.id);
    return v;
  };

  afterAll(async () => {
    // Vendor FKs cascade for Role/RolePermission/CustomerFlagCategory; users do not.
    await prisma.customerFlagCategory.deleteMany({ where: { vendorId: { in: createdVendorIds } } });
    await prisma.user.deleteMany({ where: { vendorId: { in: createdVendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } });
    await prisma.$disconnect();
  });

  it('creates the vendor, all system roles, starter flag categories and a usable VENDOR_ADMIN', async () => {
    const vendor = await track('ok');

    const roles = await prisma.role.findMany({ where: { vendorId: vendor.id }, include: { permissions: true } });
    expect(roles.map((r) => r.key).sort()).toEqual([...VENDOR_ROLE_KEYS].sort());
    expect(roles.every((r) => r.isSystem && r.permissions.length > 0)).toBe(true);

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: dto('ok').adminEmail },
      include: { roleRef: { include: { permissions: true } } },
    });
    expect(admin.vendorId).toBe(vendor.id);
    expect(admin.role).toBe(UserRole.VENDOR_ADMIN);
    // The whole point: roleId is set, so the admin resolves REAL permissions, not Access Denied.
    expect(admin.roleRef?.key).toBe('vendor_admin');
    expect(admin.roleRef?.permissions.length).toBeGreaterThan(0);
    expect(admin.password).not.toBe('Password123!');

    const flags = await prisma.customerFlagCategory.findMany({ where: { vendorId: vendor.id } });
    expect(flags.map((f) => f.name).sort()).toEqual(DEFAULT_CUSTOMER_FLAG_CATEGORIES.map((c) => c.name).sort());
  });

  it('is atomic: a duplicate admin email leaves NO half-built vendor behind', async () => {
    await track('dup');
    const before = await prisma.vendor.count();
    await expect(service.create({ ...dto('dup2'), adminEmail: dto('dup').adminEmail })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.vendor.count()).toBe(before);
    expect(await prisma.vendor.findUnique({ where: { slug: dto('dup2').slug } })).toBeNull();
  });

  it('rejects a duplicate slug', async () => {
    await track('slug');
    await expect(service.create({ ...dto('slug'), adminEmail: `other-${RUN}@example.test` })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rolls everything back when provisioning fails mid-transaction', async () => {
    const spy = jest.spyOn(provisioning, 'provisionInTx').mockRejectedValueOnce(new Error('boom'));
    const before = await prisma.vendor.count();
    await expect(service.create(dto('rollback'))).rejects.toThrow('boom');
    expect(await prisma.vendor.count()).toBe(before);
    expect(await prisma.user.findUnique({ where: { email: dto('rollback').adminEmail } })).toBeNull();
    spy.mockRestore();
  });

  it('a freshly provisioned vendor can still be deleted (seeded rows do not block removal)', async () => {
    const vendor = await service.create(dto('del'));
    await service.remove(vendor.id);
    expect(await prisma.vendor.findUnique({ where: { id: vendor.id } })).toBeNull();
    expect(await prisma.customerFlagCategory.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

  describe('repair (POST /vendors/:id/provision)', () => {
    it('is a no-op on a healthy vendor', async () => {
      const vendor = await track('healthy');
      const res = await provisioning.repair(vendor.id);
      expect(res).toMatchObject({
        rolesCreated: 0,
        driftGrantsAdded: 0,
        usersBackfilled: 0,
        customerFlagCategoriesSeeded: 0,
      });
      expect(await prisma.role.count({ where: { vendorId: vendor.id } })).toBe(VENDOR_ROLE_KEYS.length);
    });

    it('rebuilds a missing role, attaches role-less users and drops their stale permission cache', async () => {
      const vendor = await track('broken');
      const driver = await prisma.user.create({
        data: { name: 'Roleless Driver', role: UserRole.DRIVER, vendorId: vendor.id, email: `d-${RUN}@example.test` },
      });
      await prisma.role.deleteMany({ where: { vendorId: vendor.id, key: 'driver' } });
      invalidated.length = 0;

      const res = await provisioning.repair(vendor.id);

      expect(res.rolesCreated).toBe(1);
      expect(res.usersBackfilled).toBe(1);
      const fixed = await prisma.user.findUniqueOrThrow({ where: { id: driver.id }, include: { roleRef: true } });
      expect(fixed.roleRef?.key).toBe('driver');
      expect(invalidated).toEqual([driver.id]);
    });

    it('never clobbers admin customisation: a removed grant on an existing role stays removed', async () => {
      const vendor = await track('custom');
      const role = await prisma.role.findFirstOrThrow({ where: { vendorId: vendor.id, key: 'loader' } });
      const grant = await prisma.rolePermission.findFirstOrThrow({ where: { roleId: role.id } });
      await prisma.rolePermission.delete({ where: { id: grant.id } });

      await provisioning.repair(vendor.id);

      const stillThere = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permission: grant.permission },
      });
      expect(stillThere).toBeNull();
    });

    it('does not re-seed flag categories into a vendor that already has some', async () => {
      const vendor = await track('flags');
      await prisma.customerFlagCategory.deleteMany({ where: { vendorId: vendor.id, name: { not: 'VIP' } } });
      const res = await provisioning.repair(vendor.id);
      expect(res.customerFlagCategoriesSeeded).toBe(0);
      expect(await prisma.customerFlagCategory.count({ where: { vendorId: vendor.id } })).toBe(1);
    });

    it('404s an unknown vendor', async () => {
      await expect(provisioning.repair(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
