import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@water-supply-crm/database';
import { DamageCaseStatus, DamageCaseType, UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { VendorService } from './vendor.service';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PermissionService } from '../authz/permission.service';
import { CustomerService } from '../customer/customer.service';
import { DamageCaseService } from '../damage-case/damage-case.service';

/**
 * Real-Postgres regression suite for the Phase 2A tenant-security fixes (C1, C2, H1, H2 in
 * docs/features/tenant-isolation-audit.md). Two real vendors, A and B, created through the real
 * VendorService/provisioning, then attacked from A.
 *
 * Opt-in like vendor-provisioning.integration.spec.ts: needs TEST_DATABASE_URL pointing at a
 * THROWAWAY database with the current schema applied; never falls back to DATABASE_URL.
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(120000);

describeDb('Tenant security (real Postgres): vendors A and B', () => {
  const RUN = randomUUID().slice(0, 8);
  const prisma = new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://skipped:skipped@localhost:1/skipped' } } });

  // Minimal in-memory Redis stand-in (get/set/del) shared by every service under test.
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
    invalidateVendorEntity: jest.fn(),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const permissionService = new PermissionService(prisma, cache as never);
  const policy = { assertNotLastAdmin: jest.fn(async () => undefined) };

  const provisioning = new VendorProvisioningService(prisma, permissionService, audit as never);
  const vendors = new VendorService(prisma, cache as never, audit as never, provisioning);
  const users = new UserService(prisma, cache as never, audit as never, permissionService, policy as never);
  const auth = new AuthService(users, {} as never, {} as never, cache as never);
  const damage = new DamageCaseService(
    prisma,
    {} as never,
    { createMany: jest.fn(), create: jest.fn() } as never,
    { sendToVendorUsers: jest.fn(async () => undefined), sendToCustomer: jest.fn(async () => undefined) } as never,
  );

  const created = { vendorIds: [] as string[] };
  const PASSWORD = 'Password123!';

  const asUser = (u: { id: string; role: UserRole; vendorId: string | null; email?: string | null }): AuthUser => ({
    userId: u.id,
    email: u.email ?? '',
    name: 'T',
    role: u.role as never,
    vendorId: u.vendorId as never,
    customerId: null,
  });

  let A: { id: string };
  let B: { id: string };
  let adminA: AuthUser;

  beforeAll(async () => {
    A = await vendors.create({ name: `A ${RUN}`, slug: `sec-a-${RUN}`, adminEmail: `admin-a-${RUN}@t.test`, adminPassword: PASSWORD, adminName: 'Admin A' });
    B = await vendors.create({ name: `B ${RUN}`, slug: `sec-b-${RUN}`, adminEmail: `admin-b-${RUN}@t.test`, adminPassword: PASSWORD, adminName: 'Admin B' });
    created.vendorIds.push(A.id, B.id);
    adminA = asUser(await prisma.user.findUniqueOrThrow({ where: { email: `admin-a-${RUN}@t.test` } }));
  });

  afterAll(async () => {
    const ids = created.vendorIds;
    await prisma.damageCaseAuditLog.deleteMany({ where: { damageCase: { vendorId: { in: ids } } } });
    await prisma.transaction.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.damageCase.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.bottleWallet.deleteMany({ where: { customer: { vendorId: { in: ids } } } });
    await prisma.customer.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.product.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.customerFlagCategory.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
    await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ── C1 ────────────────────────────────────────────────────────────────────
  describe('C1 — no role escalation to SUPER_ADMIN', () => {
    it('A\'s VENDOR_ADMIN cannot create a SUPER_ADMIN; no such row exists afterwards', async () => {
      const email = `rogue-${RUN}@t.test`;
      await expect(
        users.create({ email, password: PASSWORD, name: 'Rogue', role: UserRole.SUPER_ADMIN, vendorId: A.id }, adminA),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('A\'s VENDOR_ADMIN cannot promote an existing employee (or themselves) to SUPER_ADMIN', async () => {
      const emp = await users.create({ email: `emp-${RUN}@t.test`, password: PASSWORD, name: 'Emp', role: UserRole.STAFF, vendorId: A.id }, adminA);
      await expect(users.update(A.id, emp.id, { role: UserRole.SUPER_ADMIN }, adminA)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(users.update(A.id, adminA.userId, { role: UserRole.SUPER_ADMIN }, adminA)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).role).toBe(UserRole.STAFF);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: adminA.userId } })).role).toBe(UserRole.VENDOR_ADMIN);
    });

    it('a real SUPER_ADMIN can still create and manage SUPER_ADMIN accounts', async () => {
      const superActor = asUser({ id: 'platform-owner', role: UserRole.SUPER_ADMIN, vendorId: null });
      const created2 = await users.create(
        { email: `platform-${RUN}@t.test`, password: PASSWORD, name: 'Platform', role: UserRole.SUPER_ADMIN },
        superActor,
      );
      expect(created2.role).toBe(UserRole.SUPER_ADMIN);
      expect(created2.vendorId).toBeNull();
    });
  });

  // ── C2 ────────────────────────────────────────────────────────────────────
  describe('C2 — customer codes are unique per vendor', () => {
    const nextCode = (vendorId: string) =>
      prisma.$transaction((tx) => (CustomerService.prototype as any).generateCustomerCode.call({}, vendorId, tx) as Promise<string>);
    const makeCustomer = (vendorId: string, customerCode: string) =>
      prisma.customer.create({ data: { vendorId, customerCode, name: `C ${customerCode}`, phoneNumber: '03001234567', address: 'x' } });

    it('both vendors start at L1 and both can create their L1 customer', async () => {
      expect(await nextCode(A.id)).toBe('L1');
      expect(await nextCode(B.id)).toBe('L1');
      const a1 = await makeCustomer(A.id, 'L1');
      const b1 = await makeCustomer(B.id, 'L1');
      expect(a1.customerCode).toBe(b1.customerCode);
      expect(a1.vendorId).not.toBe(b1.vendorId);
      // each vendor's sequence advances independently
      expect(await nextCode(A.id)).toBe('L2');
      expect(await nextCode(B.id)).toBe('L2');
    });

    it('the same vendor still cannot have two L1 customers', async () => {
      await expect(makeCustomer(A.id, 'L1')).rejects.toMatchObject({ code: 'P2002' });
    });

    it('the database no longer has the old global unique index, and has the per-vendor one', async () => {
      const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'Customer' AND indexname LIKE '%customerCode%'`;
      const names = idx.map((i) => i.indexname);
      expect(names).toContain('Customer_vendorId_customerCode_key');
      expect(names).not.toContain('Customer_customerCode_key');
    });
  });

  // ── H1 ────────────────────────────────────────────────────────────────────
  describe('H1 — inactive users', () => {
    it('a deactivated user cannot log in, an old JWT stops working, and permissions are gone; reactivation restores all three', async () => {
      const email = `leaver-${RUN}@t.test`;
      const leaver = await users.create({ email, password: PASSWORD, name: 'Leaver', role: UserRole.STAFF, vendorId: A.id }, adminA);
      const strategy = new JwtStrategy(cache as never);
      const payload = { sub: leaver.id, email, name: 'Leaver', role: 'STAFF', vendorId: A.id };

      // active: login works, JWT accepted, role permissions resolve
      await expect(auth.validateUser(email, PASSWORD)).resolves.toMatchObject({ id: leaver.id });
      await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: leaver.id });
      expect((await permissionService.getEffectivePermissions(leaver.id)).length).toBeGreaterThan(0);

      await users.deactivate(A.id, leaver.id);

      await expect(auth.validateUser(email, PASSWORD)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(permissionService.getEffectivePermissions(leaver.id)).resolves.toEqual([]);

      // Redis flag lost (flush/restart): the DB backstop still denies permission-gated routes
      store.delete(`user:${leaver.id}:inactive`);
      await expect(permissionService.getEffectivePermissions(leaver.id)).resolves.toEqual([]);

      await users.reactivate(A.id, leaver.id);
      await expect(auth.validateUser(email, PASSWORD)).resolves.toMatchObject({ id: leaver.id });
      await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: leaver.id });
      expect((await permissionService.getEffectivePermissions(leaver.id)).length).toBeGreaterThan(0);
    });
  });

  // ── H2 ────────────────────────────────────────────────────────────────────
  describe('H2 — damage cases cannot touch another vendor\'s customer', () => {
    let custB: { id: string };
    let prodB: { id: string };
    let prodA: { id: string };
    let caseB: { id: string; version: number };
    const staffA = () => adminA; // VENDOR_ADMIN of A, holds every damage_cases permission

    beforeAll(async () => {
      prodB = await prisma.product.create({ data: { vendorId: B.id, name: 'B 19L', basePrice: 100 } });
      prodA = await prisma.product.create({ data: { vendorId: A.id, name: 'A 19L', basePrice: 100 } });
      custB = await prisma.customer.create({ data: { vendorId: B.id, customerCode: 'DMG1', name: 'B customer', phoneNumber: '03009998888', address: 'x', financialBalance: 0 } });
      await prisma.bottleWallet.create({ data: { customerId: custB.id, productId: prodB.id, balance: 10 } });
      caseB = await prisma.damageCase.create({
        data: {
          vendorId: B.id,
          customerId: custB.id,
          productId: prodB.id,
          driverId: adminA.userId,
          bottleCount: 2,
          caseType: DamageCaseType.DAMAGE,
          status: DamageCaseStatus.UNDER_REVIEW,
          photoKeys: ['k'],
          version: 0,
        },
      });
    });

    const balanceOfB = async () => (await prisma.customer.findUniqueOrThrow({ where: { id: custB.id } })).financialBalance;
    const walletOfB = async () => (await prisma.bottleWallet.findFirstOrThrow({ where: { customerId: custB.id } })).balance;

    it('A cannot charge B\'s case: 404, B\'s balance, wallet and ledger are untouched', async () => {
      await expect(
        damage.charge(staffA(), caseB.id, { chargeAmount: 5000, version: 0, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await balanceOfB()).toBe(0);
      expect(await walletOfB()).toBe(10);
      expect(await prisma.transaction.count({ where: { customerId: custB.id } })).toBe(0);
      expect((await prisma.damageCase.findUniqueOrThrow({ where: { id: caseB.id } })).status).toBe(DamageCaseStatus.UNDER_REVIEW);
    });

    it('A cannot waive, review, update or reverse B\'s case', async () => {
      await expect(damage.waive(staffA(), caseB.id, { version: 0, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(damage.review(staffA(), caseB.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(damage.update(staffA(), caseB.id, { bottleCount: 9, version: 0 } as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(damage.reverse(staffA(), caseB.id, { version: 0 })).rejects.toBeInstanceOf(NotFoundException);
      expect(await walletOfB()).toBe(10);
      expect((await prisma.damageCase.findUniqueOrThrow({ where: { id: caseB.id } })).status).toBe(DamageCaseStatus.UNDER_REVIEW);
    });

    it('A cannot file a case against B\'s customer or product', async () => {
      const before = await prisma.damageCase.count({ where: { vendorId: A.id } });
      await expect(
        damage.report(staffA(), { customerId: custB.id, productId: prodA.id, bottleCount: 1, photoKeys: [] } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      const custA = await prisma.customer.create({ data: { vendorId: A.id, customerCode: 'DMG-A', name: 'A c', phoneNumber: '03001112222', address: 'x' } });
      await expect(
        damage.report(staffA(), { customerId: custA.id, productId: prodB.id, bottleCount: 1, photoKeys: [] } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.damageCase.count({ where: { vendorId: A.id } })).toBe(before);
    });

    it('B itself can still charge its own case (not over-blocked)', async () => {
      const adminB = asUser(await prisma.user.findUniqueOrThrow({ where: { email: `admin-b-${RUN}@t.test` } }));
      await damage.charge(adminB, caseB.id, { chargeAmount: 300, version: 0, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never);
      expect(await balanceOfB()).toBe(300);
      expect((await prisma.damageCase.findUniqueOrThrow({ where: { id: caseB.id } })).status).toBe(DamageCaseStatus.CHARGED);
    });

    it('a legacy row in B pointing at A\'s customer is refused by charge (defence in depth)', async () => {
      const custA = await prisma.customer.create({ data: { vendorId: A.id, customerCode: 'DMG-LEG', name: 'A legacy', phoneNumber: '03001113333', address: 'x' } });
      await prisma.bottleWallet.create({ data: { customerId: custA.id, productId: prodB.id, balance: 10 } });
      const legacy = await prisma.damageCase.create({
        data: { vendorId: B.id, customerId: custA.id, productId: prodB.id, driverId: adminA.userId, bottleCount: 1, status: DamageCaseStatus.UNDER_REVIEW, photoKeys: ['k'], version: 0 },
      });
      const adminB = asUser(await prisma.user.findUniqueOrThrow({ where: { email: `admin-b-${RUN}@t.test` } }));
      await expect(damage.charge(adminB, legacy.id, { chargeAmount: 999, version: 0, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never)).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: custA.id } })).financialBalance).toBe(0);
    });
  });
});

