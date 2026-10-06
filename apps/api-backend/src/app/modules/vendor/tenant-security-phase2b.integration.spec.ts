import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DispatchStatus, UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { VendorService, vendorSuspendedKey } from './vendor.service';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PermissionService } from '../authz/permission.service';
import { AuditController } from '../audit/audit.controller';
import { AuditService } from '../audit/audit.service';
import { DamageCaseService } from '../damage-case/damage-case.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { OrderService } from '../order/order.service';

/**
 * Real-Postgres regression suite for the Phase 2B tenant-security fixes (M1, M3, M6, L1 in
 * docs/features/tenant-isolation-audit.md). Vendors A and B are created through the real
 * VendorService/provisioning, then attacked from A.
 *
 * Opt-in like the other integration suites: needs TEST_DATABASE_URL pointing at a THROWAWAY database with
 * the current schema applied; never falls back to DATABASE_URL.
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(120000);

describeDb('Tenant security phase 2B (real Postgres)', () => {
  const RUN = randomUUID().slice(0, 8);
  const PASSWORD = 'Password123!';
  const prisma = new PrismaService({
    datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://skipped:skipped@localhost:1/skipped' } },
  });

  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
    invalidateVendorEntity: jest.fn(),
  };
  const noopAudit = { log: jest.fn(async () => undefined) };
  const anything = new Proxy({}, { get: () => jest.fn(async () => undefined) }) as never;

  const permissionService = new PermissionService(prisma, cache as never);
  const provisioning = new VendorProvisioningService(prisma, permissionService, noopAudit as never);
  const vendors = new VendorService(prisma, cache as never, noopAudit as never, provisioning);
  const users = new UserService(prisma, cache as never, noopAudit as never, permissionService, { assertNotLastAdmin: jest.fn() } as never);
  const auth = new AuthService(users, {} as never, {} as never, cache as never);
  const damage = new DamageCaseService(prisma, {} as never, anything, anything);
  const warehouse = new WarehouseService(prisma, {} as never);
  const orders = new OrderService(prisma, anything, anything, cache as never, {} as never);
  const auditController = new AuditController(new AuditService(prisma));

  const vendorIds: string[] = [];
  const asUser = (u: { id: string; role: UserRole; vendorId: string | null }): AuthUser => ({
    userId: u.id,
    email: '',
    name: 'T',
    role: u.role as never,
    vendorId: u.vendorId as never,
    customerId: null,
  });
  const makeVendor = async (tag: string) => {
    const v = await vendors.create({ name: `${tag} ${RUN}`, slug: `p2b-${tag}-${RUN}`, adminEmail: `admin-${tag}-${RUN}@t.test`, adminPassword: PASSWORD, adminName: `Admin ${tag}` });
    vendorIds.push(v.id);
    const admin = asUser(await prisma.user.findUniqueOrThrow({ where: { email: `admin-${tag}-${RUN}@t.test` } }));
    return { v, admin };
  };

  let A: Awaited<ReturnType<typeof makeVendor>>;
  let B: Awaited<ReturnType<typeof makeVendor>>;
  let prodA: { id: string };
  let prodB: { id: string };

  beforeAll(async () => {
    A = await makeVendor('a');
    B = await makeVendor('b');
    prodA = await prisma.product.create({ data: { vendorId: A.v.id, name: 'A 19L', basePrice: 100 } });
    prodB = await prisma.product.create({ data: { vendorId: B.v.id, name: 'B 19L', basePrice: 100 } });
  });

  afterAll(async () => {
    const ids = vendorIds;
    await prisma.repairBatch.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.warehouseTransaction.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.warehouseStock.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.customerOrder.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.damageCaseAuditLog.deleteMany({ where: { damageCase: { vendorId: { in: ids } } } });
    await prisma.damageCase.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.van.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.product.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.customerFlagCategory.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { vendorId: { in: ids } } });
    await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ── M1 ────────────────────────────────────────────────────────────────────
  describe('M1 — audit-log detail is tenant-scoped', () => {
    it('A cannot read B\'s audit log by id; A can read its own; SUPER_ADMIN can read any', async () => {
      const logA = await prisma.auditLog.create({ data: { vendorId: A.v.id, action: 'UPDATE', entity: 'Customer', changes: { after: { name: 'A' } } } });
      const logB = await prisma.auditLog.create({ data: { vendorId: B.v.id, action: 'UPDATE', entity: 'Customer', changes: { after: { name: 'B secret' } } } });

      await expect(auditController.findOne(A.admin, logB.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(auditController.findOne(A.admin, logA.id)).resolves.toMatchObject({ id: logA.id });
      await expect(
        auditController.findOne(asUser({ id: 'platform', role: UserRole.SUPER_ADMIN, vendorId: null }), logB.id),
      ).resolves.toMatchObject({ id: logB.id });
    });
  });

  // ── M3 ────────────────────────────────────────────────────────────────────
  describe('M3 — client-supplied storage keys must be the caller\'s own', () => {
    let custA: { id: string };
    beforeAll(async () => {
      custA = await prisma.customer.create({ data: { vendorId: A.v.id, customerCode: 'M3-A', name: 'A cust', phoneNumber: '03001230000', address: 'x' } });
    });
    const report = (photoKeys: string[]) =>
      damage.report(A.admin, { customerId: custA.id, productId: prodA.id, bottleCount: 1, photoKeys } as never);

    it('a damage case cannot attach vendor B\'s photo, an arbitrary bucket path, or another prefix\'s file', async () => {
      const before = await prisma.damageCase.count({ where: { vendorId: A.v.id } });
      for (const key of [`damage-photos/${B.v.id}/${randomUUID()}.jpg`, 'whatsapp-session/creds.json', `payment-screenshots/${A.v.id}/x.jpg`]) {
        await expect(report([key])).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await prisma.damageCase.count({ where: { vendorId: A.v.id } })).toBe(before);
    });

    it('its own vendor-scoped key and a legacy key are accepted', async () => {
      await expect(report([`damage-photos/${A.v.id}/${randomUUID()}.jpg`])).resolves.toMatchObject({ vendorId: A.v.id });
      await expect(report([`damage-photos/${randomUUID()}.jpg`])).resolves.toMatchObject({ vendorId: A.v.id });
    });
  });

  // ── M6 ────────────────────────────────────────────────────────────────────
  describe('M6 — vendor suspension survives a Redis flush', () => {
    it('login is refused from the DB state, the flag is re-seeded on boot, and unsuspend restores access', async () => {
      const C = await makeVendor('c');
      const email = `admin-c-${RUN}@t.test`;
      const strategy = new JwtStrategy(cache as never);
      const payload = { sub: C.admin.userId, email, name: 'Admin c', role: 'VENDOR_ADMIN', vendorId: C.v.id };

      await expect(auth.validateUser(email, PASSWORD)).resolves.toMatchObject({ id: C.admin.userId });

      await vendors.suspend(C.v.id);
      await expect(auth.validateUser(email, PASSWORD)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);

      // Redis flushed: the live JWT check loses the flag, but a NEW login is still refused (DB)…
      store.delete(vendorSuspendedKey(C.v.id));
      await expect(auth.validateUser(email, PASSWORD)).rejects.toBeInstanceOf(UnauthorizedException);
      // …and the next boot re-seeds the flag from the database.
      await vendors.onModuleInit();
      expect(store.get(vendorSuspendedKey(C.v.id))).toBe(true);
      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);

      await vendors.unsuspend(C.v.id);
      await expect(auth.validateUser(email, PASSWORD)).resolves.toMatchObject({ id: C.admin.userId });
      await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: C.admin.userId });
    });
  });

  // ── L1 ────────────────────────────────────────────────────────────────────
  describe('L1 — warehouse only touches the vendor\'s own products', () => {
    it('opening balance for B\'s product is refused and leaves no stock row for A', async () => {
      await expect(
        warehouse.openingBalance(A.v.id, { productId: prodB.id, filledCount: 5, emptyCount: 0, damagedCount: 0, leakedCount: 0, inRepairCount: 0 } as never, A.admin.userId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.warehouseStock.count({ where: { vendorId: A.v.id, productId: prodB.id } })).toBe(0);
    });

    it('send-to-repair for B\'s product is refused and rolls back its repair batch', async () => {
      await expect(
        warehouse.sendRepair(A.v.id, { productId: prodB.id, quantity: 1, shopName: 'Shop', fromStock: 'damaged' } as never, A.admin.userId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.repairBatch.count({ where: { vendorId: A.v.id } })).toBe(0);
      expect(await prisma.warehouseStock.count({ where: { vendorId: A.v.id, productId: prodB.id } })).toBe(0);
    });

    it('A\'s own product still works', async () => {
      await warehouse.openingBalance(A.v.id, { productId: prodA.id, filledCount: 5, emptyCount: 1, damagedCount: 0, leakedCount: 0, inRepairCount: 0 } as never, A.admin.userId);
      expect(await prisma.warehouseStock.count({ where: { vendorId: A.v.id, productId: prodA.id } })).toBe(1);
    });
  });

  describe('L1 — order dispatch plan only names the vendor\'s own van and driver', () => {
    let orderA: { id: string };
    let vanA: { id: string };
    let vanB: { id: string };
    const targetDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    beforeAll(async () => {
      const cust = await prisma.customer.create({ data: { vendorId: A.v.id, customerCode: 'L1-A', name: 'A cust', phoneNumber: '03001239999', address: 'x' } });
      orderA = await prisma.customerOrder.create({ data: { vendorId: A.v.id, customerId: cust.id, productId: prodA.id, quantity: 1, status: 'APPROVED' } });
      vanA = await prisma.van.create({ data: { vendorId: A.v.id, plateNumber: `A-${RUN}` } });
      vanB = await prisma.van.create({ data: { vendorId: B.v.id, plateNumber: `B-${RUN}` } });
    });

    const plan = (over: Record<string, unknown>) =>
      orders.createDispatchPlan(A.v.id, orderA.id, { targetDate, dispatchMode: 'QUEUE_FOR_GENERATION', ...over } as never, A.admin.userId);
    const stillUnplanned = async () =>
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderA.id } })).dispatchStatus === DispatchStatus.UNPLANNED;

    it('B\'s van and B\'s driver are refused; the order stays unplanned', async () => {
      await expect(plan({ vanId: vanB.id })).rejects.toBeInstanceOf(NotFoundException);
      await expect(plan({ driverId: B.admin.userId })).rejects.toBeInstanceOf(NotFoundException);
      expect(await stillUnplanned()).toBe(true);
    });

    it('A\'s own van and driver are accepted', async () => {
      const planned = await plan({ vanId: vanA.id, driverId: A.admin.userId });
      expect(planned).toMatchObject({ dispatchVanId: vanA.id, dispatchDriverId: A.admin.userId });
    });
  });
});
