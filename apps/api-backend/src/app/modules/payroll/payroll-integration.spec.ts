import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import {
  AttendanceSource,
  AttendanceStatus,
  LedgerEntryStatus,
  PayFrequency,
  PayrollEntryStatus,
  PayrollPeriodStatus,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { StaffLedgerService } from './staff-ledger.service';
import { PayrollEntryService } from './payroll-entry.service';
import { PayrollPeriodService } from './payroll-period.service';
import type { CreateStaffLedgerEntryDto } from './dto/create-staff-ledger-entry.dto';

/**
 * Real-database integration test (Phase 2 dispatch) — exercises the full
 * ledger -> draft -> approve -> lock payroll pipeline against an actual local
 * Postgres, with NO mocked Prisma anywhere. The category-bucket sign mapping
 * itself is already unit-tested (with a mocked Prisma client) in
 * `payroll-entry.service.spec.ts`; this file's job is proving those already
 *-correct pieces compose correctly end-to-end and that every number that
 * comes out the other end is exactly right.
 *
 * `StaffLedgerService.reverse()` only accepts an entry whose
 * `payrollEntryId` is already set (i.e. already rolled into a lock) — see
 * its guard clause. To reverse the ADJUSTMENT entry and then prove the
 * ADJUSTMENT+REVERSAL pair both land in the SAME final snapshot, this test
 * therefore runs an intentional lock -> reverse -> unlock -> re-lock cycle:
 * the first lock claims the ledger entries (making the ADJUSTMENT entry
 * reversible), the reverse creates the offsetting REVERSAL row, the unlock
 * frees every claimed ledger entry back to unclaimed (per
 * `PayrollPeriodService.unlockPeriod`'s documented behaviour), and the final
 * lock recomputes fresh — via the exact same `computeEntryBreakdown` method
 * `generateDraft` uses — picking up both the freed original and the new
 * REVERSAL in one pass. This is a deliberate sequencing choice necessitated
 * by `reverse()`'s real precondition, not a workaround for a bug.
 *
 * The system clock is pinned to a fixed instant inside the test period
 * (rather than relying on whatever day this happens to run on) only around
 * the two calls that internally read `new Date()` with no argument
 * (`PayrollPeriodService.getOrCreateOpenPeriod` and
 * `StaffLedgerService.reverse`), using Jest's fake timers with `doNotFake`
 * covering every timer API so real DB I/O over the network is never
 * affected — only `Date`/`Date.now()` are frozen.
 */

jest.setTimeout(60000);

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://admin:admin123@localhost:5432/water_supply_crm?schema=public';

const RUN_ID = randomUUID().slice(0, 8);
const FIXED_NOW = new Date('2026-08-15T12:00:00.000Z'); // inside the Aug 2026 test period

/** Runs `fn` with the global clock pinned to `FIXED_NOW`; every fake-timer-able API except 'Date' is
 *  explicitly left real via `doNotFake`, so real async DB I/O over the network is never affected —
 *  only `new Date()`/`Date.now()` are frozen. */
async function withFixedNow<T>(fn: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  try {
    return await fn();
  } finally {
    jest.useRealTimers();
  }
}

const prisma = new PrismaService({ datasourceUrl: DATABASE_URL });

/** Unused by every method this test exercises (create/reverse/generateDraft/approveEntry/lockPeriod/unlockPeriod
 *  never call `PermissionService` — only `getBreakdown`/`findForEmployee` do, neither of which is called here).
 *  Matches the stub convention already used for this same reason elsewhere in this module's specs. */
const unusedPermissions = {
  can: async () => {
    throw new Error('PermissionService.can should not be called by any code path exercised in this test.');
  },
} as any;

const approvalGate = new PayrollApprovalGateService(prisma);
const staffLedgerService = new StaffLedgerService(prisma, approvalGate, unusedPermissions);
const payrollEntryService = new PayrollEntryService(prisma, unusedPermissions);
const payrollPeriodService = new PayrollPeriodService(prisma, payrollEntryService);

let vendorId: string;
let adminUserId: string;
let driverId: string; // Employee 1
let loaderId: string; // Employee 2
let staffNoSalaryId: string; // Employee 3 — no SalaryStructure

let adminAuthUser: AuthUser;

async function assertDatabaseReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const redactedUrl = DATABASE_URL.replace(/:[^:@/]+@/, ':***@');
    throw new Error(
      `payroll-integration.spec.ts requires a reachable local Postgres at "${redactedUrl}". ` +
        `Start it (e.g. \`docker compose up -d postgres\`) before running this test. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function ledgerDto(userId: string, category: StaffLedgerCategory, amount: number, effectiveDate: string, description: string): CreateStaffLedgerEntryDto {
  return { userId, category, amount, effectiveDate, description };
}

/** Minimal shape `cleanupTestData` needs — narrow enough to satisfy with a plain jest.fn() mock in the guard tests below. */
interface CleanupClient {
  payrollEntryAuditLog: { deleteMany: (args: unknown) => Promise<unknown> };
  payrollSnapshot: { deleteMany: (args: unknown) => Promise<unknown> };
  staffLedgerAuditLog: { deleteMany: (args: unknown) => Promise<unknown> };
  staffLedgerEntry: { deleteMany: (args: unknown) => Promise<unknown> };
  payrollEntry: { deleteMany: (args: unknown) => Promise<unknown> };
  payrollPeriod: { deleteMany: (args: unknown) => Promise<unknown> };
  salaryStructure: { deleteMany: (args: unknown) => Promise<unknown> };
  staffAttendance: { deleteMany: (args: unknown) => Promise<unknown> };
  payrollVendorConfig: { deleteMany: (args: unknown) => Promise<unknown> };
  user: { deleteMany: (args: unknown) => Promise<unknown> };
  vendor: { delete: (args: unknown) => Promise<unknown> };
}

/**
 * Deletes every row this test created, scoped to a single `vendorId`.
 *
 * GUARD: `targetVendorId` is falsy whenever `beforeAll` failed before (or at)
 * `vendor.create()` — e.g. the DB was unreachable, or vendor creation itself
 * threw — since `vendorId` in the outer scope is only ever assigned right
 * after that create resolves. Prisma silently DROPS an `undefined`-valued key
 * from a `where` filter (it does NOT treat it as "match nothing"), so without
 * this guard every `deleteMany({ where: { vendorId } })` below would become
 * an effectively unscoped `deleteMany({})` against the real local Postgres —
 * wiping those tables vendor-wide, not just this run's rows. The guard is
 * proven in isolation by the "cleanupTestData guard" tests below, against a
 * fully mocked client, so it is verified without ever risking a real
 * unscoped delete.
 */
async function cleanupTestData(client: CleanupClient, targetVendorId: string | undefined): Promise<void> {
  if (!targetVendorId) return;

  await client.payrollEntryAuditLog.deleteMany({ where: { payrollEntry: { vendorId: targetVendorId } } });
  await client.payrollSnapshot.deleteMany({ where: { payrollEntry: { vendorId: targetVendorId } } });
  await client.staffLedgerAuditLog.deleteMany({ where: { ledgerEntry: { vendorId: targetVendorId } } });
  await client.staffLedgerEntry.deleteMany({ where: { vendorId: targetVendorId } });
  await client.payrollEntry.deleteMany({ where: { vendorId: targetVendorId } });
  await client.payrollPeriod.deleteMany({ where: { vendorId: targetVendorId } });
  await client.salaryStructure.deleteMany({ where: { vendorId: targetVendorId } });
  await client.staffAttendance.deleteMany({ where: { vendorId: targetVendorId } });
  await client.payrollVendorConfig.deleteMany({ where: { vendorId: targetVendorId } });
  await client.user.deleteMany({ where: { vendorId: targetVendorId } });
  await client.vendor.delete({ where: { id: targetVendorId } });
}

beforeAll(async () => {
  await assertDatabaseReachable();

  const vendor = await prisma.vendor.create({
    data: { name: `Payroll Integration Test Vendor ${RUN_ID}`, slug: `payroll-itest-${RUN_ID}` },
  });
  vendorId = vendor.id;

  const admin = await prisma.user.create({
    data: {
      vendorId,
      role: UserRole.VENDOR_ADMIN,
      name: `Payroll ITest Admin ${RUN_ID}`,
      email: `payroll-itest-admin-${RUN_ID}@test.local`,
    },
  });
  adminUserId = admin.id;
  adminAuthUser = {
    userId: admin.id,
    email: admin.email as string,
    name: admin.name,
    role: 'VENDOR_ADMIN',
    vendorId,
    customerId: null,
  };

  const driver = await prisma.user.create({
    data: {
      vendorId,
      role: UserRole.DRIVER,
      name: `Payroll ITest Driver ${RUN_ID}`,
      email: `payroll-itest-driver-${RUN_ID}@test.local`,
    },
  });
  driverId = driver.id;

  const loader = await prisma.user.create({
    data: {
      vendorId,
      role: UserRole.LOADER,
      name: `Payroll ITest Loader ${RUN_ID}`,
      email: `payroll-itest-loader-${RUN_ID}@test.local`,
    },
  });
  loaderId = loader.id;

  const staffNoSalary = await prisma.user.create({
    data: {
      vendorId,
      role: UserRole.STAFF,
      name: `Payroll ITest Staff (no salary) ${RUN_ID}`,
      email: `payroll-itest-staff-nosalary-${RUN_ID}@test.local`,
    },
  });
  staffNoSalaryId = staffNoSalary.id;

  await prisma.salaryStructure.create({
    data: {
      vendorId,
      userId: driverId,
      baseAmount: 30000,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      createdById: adminUserId,
    },
  });

  await prisma.salaryStructure.create({
    data: {
      vendorId,
      userId: loaderId,
      baseAmount: 25000,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      createdById: adminUserId,
    },
  });

  await prisma.payrollVendorConfig.create({
    data: { vendorId, cutoffDay: 1, autoLockEnabled: false, updatedById: adminUserId },
  });
});

afterAll(async () => {
  try {
    await cleanupTestData(prisma, vendorId);
  } finally {
    await prisma.$disconnect();
  }
});

describe('cleanupTestData guard', () => {
  function makeMockClient(): CleanupClient {
    return {
      payrollEntryAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      payrollSnapshot: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      staffLedgerAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      staffLedgerEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      payrollEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      payrollPeriod: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      salaryStructure: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      staffAttendance: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      payrollVendorConfig: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      vendor: { delete: jest.fn().mockResolvedValue({}) },
    };
  }

  it('issues zero delete calls when vendorId is undefined — never falls through to an unscoped wipe', async () => {
    const client = makeMockClient();

    await cleanupTestData(client, undefined);

    expect(client.payrollEntryAuditLog.deleteMany).not.toHaveBeenCalled();
    expect(client.payrollSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(client.staffLedgerAuditLog.deleteMany).not.toHaveBeenCalled();
    expect(client.staffLedgerEntry.deleteMany).not.toHaveBeenCalled();
    expect(client.payrollEntry.deleteMany).not.toHaveBeenCalled();
    expect(client.payrollPeriod.deleteMany).not.toHaveBeenCalled();
    expect(client.salaryStructure.deleteMany).not.toHaveBeenCalled();
    expect(client.staffAttendance.deleteMany).not.toHaveBeenCalled();
    expect(client.payrollVendorConfig.deleteMany).not.toHaveBeenCalled();
    expect(client.user.deleteMany).not.toHaveBeenCalled();
    expect(client.vendor.delete).not.toHaveBeenCalled();
  });

  it('issues zero delete calls when vendorId is an empty string — falsy, same as undefined', async () => {
    const client = makeMockClient();

    await cleanupTestData(client, '');

    expect(client.vendor.delete).not.toHaveBeenCalled();
    expect(client.user.deleteMany).not.toHaveBeenCalled();
  });

  it('scopes every delete to the given vendorId when it is a real id', async () => {
    const client = makeMockClient();
    const realVendorId = 'a-real-vendor-id';

    await cleanupTestData(client, realVendorId);

    expect(client.payrollEntryAuditLog.deleteMany).toHaveBeenCalledWith({ where: { payrollEntry: { vendorId: realVendorId } } });
    expect(client.payrollSnapshot.deleteMany).toHaveBeenCalledWith({ where: { payrollEntry: { vendorId: realVendorId } } });
    expect(client.staffLedgerAuditLog.deleteMany).toHaveBeenCalledWith({ where: { ledgerEntry: { vendorId: realVendorId } } });
    expect(client.staffLedgerEntry.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.payrollEntry.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.payrollPeriod.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.salaryStructure.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.staffAttendance.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.payrollVendorConfig.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.user.deleteMany).toHaveBeenCalledWith({ where: { vendorId: realVendorId } });
    expect(client.vendor.delete).toHaveBeenCalledWith({ where: { id: realVendorId } });
  });
});

it('runs the full ledger -> draft -> approve -> lock payroll pipeline with exact arithmetic', async () => {
  // ── Phase 1: open the August 2026 period (cutoffDay=1, pinned clock) ──────
  const period = await withFixedNow(() => payrollPeriodService.getOrCreateOpenPeriod(adminAuthUser));
  expect(period.periodLabel).toBe('2026-08');
  expect(period.startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  expect(period.endDate.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  expect(period.status).toBe(PayrollPeriodStatus.OPEN);

  // ── Phase 2: post the ledger entries (all POSTED immediately — no PayrollApprovalRule row exists for this vendor) ──
  const bonusEntry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.BONUS, 1000, '2026-08-05', 'Performance bonus'),
  );
  const advanceE1Entry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.ADVANCE, -5000, '2026-08-06', 'Cash advance'),
  );
  const penaltyEntry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.PENALTY, -500, '2026-08-07', 'Late delivery penalty'),
  );
  const expenseEntry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.EXPENSE_REIMBURSEMENT, 2000, '2026-08-08', 'Fuel reimbursement'),
  );
  const overtimeEntry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.OVERTIME, 300, '2026-08-09', 'Extra shift'),
  );
  const adjustmentEntry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(driverId, StaffLedgerCategory.ADJUSTMENT, -200, '2026-08-10', 'Manual correction'),
  );
  const advanceE2Entry = await staffLedgerService.create(
    adminAuthUser,
    ledgerDto(loaderId, StaffLedgerCategory.ADVANCE, -3000, '2026-08-06', 'Cash advance'),
  );

  for (const entry of [bonusEntry, advanceE1Entry, penaltyEntry, expenseEntry, overtimeEntry, adjustmentEntry, advanceE2Entry]) {
    expect(entry.status).toBe(LedgerEntryStatus.POSTED);
  }

  // ── Phase 3: first draft generation — pre-reversal numbers, and Employee 3's exclusion ──
  const draft1 = await payrollEntryService.generateDraft(adminAuthUser, period.id);

  expect(draft1.generated.sort()).toEqual([driverId, loaderId].sort());
  expect(draft1.skippedMissingSalaryStructure).toEqual([{ userId: staffNoSalaryId, name: `Payroll ITest Staff (no salary) ${RUN_ID}` }]);
  expect(draft1.skippedDataError).toEqual([]);
  expect(draft1.skippedAlreadyReviewed).toEqual([]);

  const entry1AfterDraft1 = await prisma.payrollEntry.findUniqueOrThrow({
    where: { periodId_userId: { periodId: period.id, userId: driverId } },
  });
  // Hand-computed: 30000 (base) + 1000 (bonus) + 300 (overtime) + 0 (incentives)
  //   - 5000 (advance) + 2000 (expenses) - 500 (penalty) - 200 (adjustment, only ledger
  //   entry so far in otherDeductions) + 0 (carryForwardIn) = 27600
  expect(entry1AfterDraft1.baseSalary).toBe(30000);
  expect(entry1AfterDraft1.bonuses).toBe(1000);
  expect(entry1AfterDraft1.overtime).toBe(300);
  expect(entry1AfterDraft1.incentives).toBe(0);
  expect(entry1AfterDraft1.advances).toBe(-5000);
  expect(entry1AfterDraft1.expenses).toBe(2000);
  expect(entry1AfterDraft1.penalties).toBe(-500);
  expect(entry1AfterDraft1.otherDeductions).toBe(-200);
  expect(entry1AfterDraft1.carryForwardIn).toBe(0);
  expect(entry1AfterDraft1.finalPayable).toBe(27600);
  expect(entry1AfterDraft1.status).toBe(PayrollEntryStatus.DRAFT);

  const entry2AfterDraft1 = await prisma.payrollEntry.findUniqueOrThrow({
    where: { periodId_userId: { periodId: period.id, userId: loaderId } },
  });
  // Hand-computed: 25000 (base) - 3000 (advance) = 22000
  expect(entry2AfterDraft1.baseSalary).toBe(25000);
  expect(entry2AfterDraft1.advances).toBe(-3000);
  expect(entry2AfterDraft1.bonuses).toBe(0);
  expect(entry2AfterDraft1.overtime).toBe(0);
  expect(entry2AfterDraft1.incentives).toBe(0);
  expect(entry2AfterDraft1.expenses).toBe(0);
  expect(entry2AfterDraft1.penalties).toBe(0);
  expect(entry2AfterDraft1.otherDeductions).toBe(0);
  expect(entry2AfterDraft1.carryForwardIn).toBe(0);
  expect(entry2AfterDraft1.finalPayable).toBe(22000);

  const entry3 = await prisma.payrollEntry.findUnique({
    where: { periodId_userId: { periodId: period.id, userId: staffNoSalaryId } },
  });
  expect(entry3).toBeNull(); // never silently defaulted to baseSalary: 0

  // ── Phase 4: approve both draft entries ──────────────────────────────────
  await payrollEntryService.approveEntry(adminAuthUser, entry1AfterDraft1.id, entry1AfterDraft1.version);
  await payrollEntryService.approveEntry(adminAuthUser, entry2AfterDraft1.id, entry2AfterDraft1.version);

  // ── Phase 5: first lock — claims all posted ledger entries in the period, unblocking reverse() ──
  const lock1 = await payrollPeriodService.lockPeriod(adminAuthUser, period.id);
  expect(lock1.lockedEntryCount).toBe(2);
  expect(lock1.period.status).toBe(PayrollPeriodStatus.LOCKED);

  const adjustmentAfterLock1 = await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: adjustmentEntry.id } });
  expect(adjustmentAfterLock1.payrollEntryId).toBe(entry1AfterDraft1.id);
  expect(adjustmentAfterLock1.status).toBe(LedgerEntryStatus.POSTED);

  // At lock 1, the freshly-recomputed finalPayable (27600, no REVERSAL yet) equals what was
  // already stored (27600, from generateDraft/approve) — no divergence, so no
  // `approvedFinalPayable` key should be written onto this snapshot.
  const [snapshot1AfterLock1] = await prisma.payrollSnapshot.findMany({
    where: { payrollEntryId: entry1AfterDraft1.id },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  expect(snapshot1AfterLock1).toBeDefined();
  expect(snapshot1AfterLock1.breakdownJson).not.toHaveProperty('approvedFinalPayable');

  // ── Phase 6: reverse the ADJUSTMENT entry (legal now that it's rolled into a locked period) ──
  const { original: adjustmentAfterReverse, reversal: reversalEntry } = await withFixedNow(() =>
    staffLedgerService.reverse(adminAuthUser, adjustmentEntry.id, {
      version: adjustmentAfterLock1.version,
      reason: 'Integration test: verify REVERSAL nets back to zero',
    }),
  );
  expect(reversalEntry.category).toBe(StaffLedgerCategory.REVERSAL);
  expect(reversalEntry.amount).toBe(200); // opposite sign of the -200 original
  expect(reversalEntry.status).toBe(LedgerEntryStatus.POSTED);
  expect(reversalEntry.reversedEntryId).toBe(adjustmentEntry.id);
  expect(reversalEntry.payrollEntryId).toBeNull();
  expect(reversalEntry.effectiveDate.toISOString()).toBe(FIXED_NOW.toISOString());
  expect(adjustmentAfterReverse.payrollEntryId).toBe(entry1AfterDraft1.id); // untouched by reverse()

  // ── Phase 7: unlock — frees every claimed ledger entry back to unclaimed, entries back to APPROVED ──
  const unlockResult = await payrollPeriodService.unlockPeriod(adminAuthUser, period.id, 'Reopen to fold in ADJUSTMENT reversal');
  expect(unlockResult.unlockedEntryCount).toBe(2);
  expect(unlockResult.period.status).toBe(PayrollPeriodStatus.REVIEW);

  const adjustmentAfterUnlock = await prisma.staffLedgerEntry.findUniqueOrThrow({ where: { id: adjustmentEntry.id } });
  expect(adjustmentAfterUnlock.payrollEntryId).toBeNull();

  // ── Phase 8: final lock — recomputes fresh via computeEntryBreakdown, picking up the freed
  //    original ADJUSTMENT and the still-unclaimed REVERSAL together in one pass ──
  const lock2 = await payrollPeriodService.lockPeriod(adminAuthUser, period.id);
  expect(lock2.lockedEntryCount).toBe(2);
  expect(lock2.period.status).toBe(PayrollPeriodStatus.LOCKED);

  const finalEntry1 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry1AfterDraft1.id } });
  expect(finalEntry1.status).toBe(PayrollEntryStatus.LOCKED);
  expect(finalEntry1.baseSalary).toBe(30000);
  expect(finalEntry1.bonuses).toBe(1000);
  expect(finalEntry1.overtime).toBe(300);
  expect(finalEntry1.incentives).toBe(0);
  expect(finalEntry1.advances).toBe(-5000);
  expect(finalEntry1.expenses).toBe(2000);
  expect(finalEntry1.penalties).toBe(-500);
  // ADJUSTMENT (-200) + REVERSAL (+200) both fold into otherDeductions and net to 0
  expect(finalEntry1.otherDeductions).toBe(0);
  expect(finalEntry1.carryForwardIn).toBe(0);
  // Hand-computed: 30000 + 1000 + 300 + 0 - 5000 + 2000 - 500 + 0 + 0 = 27800
  expect(finalEntry1.finalPayable).toBe(27800);

  const finalEntry2 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry2AfterDraft1.id } });
  expect(finalEntry2.status).toBe(PayrollEntryStatus.LOCKED);
  expect(finalEntry2.advances).toBe(-3000);
  expect(finalEntry2.finalPayable).toBe(22000); // unaffected by the reversal, unchanged from Phase 3

  // ── Phase 9: verify the latest PayrollSnapshot per entry carries the correct frozen breakdown
  //    and that the reversed pair (ADJUSTMENT + REVERSAL) are BOTH individually present, not collapsed ──
  const [snapshot1] = await prisma.payrollSnapshot.findMany({
    where: { payrollEntryId: finalEntry1.id },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  expect(snapshot1).toBeDefined();
  // Full exact match (not toMatchObject) — this is the one place positioned to prove the
  // "late-change divergence" transparency feature end-to-end: lock 1 stored finalPayable=27600
  // for this entry; lock 2 recomputes 27800 (the reversal netted in) — since they differ,
  // lockPeriod must have written `approvedFinalPayable: 27600` alongside the fresh numbers.
  expect(snapshot1.breakdownJson).toEqual({
    baseSalary: 30000,
    bonuses: 1000,
    overtime: 300,
    incentives: 0,
    advances: -5000,
    expenses: 2000,
    penalties: -500,
    otherDeductions: 0,
    carryForwardIn: 0,
    finalPayable: 27800,
    approvedFinalPayable: 27600,
  });
  const expectedEntry1LedgerIds = [
    bonusEntry.id,
    advanceE1Entry.id,
    penaltyEntry.id,
    expenseEntry.id,
    overtimeEntry.id,
    adjustmentEntry.id,
    reversalEntry.id,
  ];
  expect(snapshot1.ledgerEntryIds as string[]).toHaveLength(7);
  expect(new Set(snapshot1.ledgerEntryIds as string[])).toEqual(new Set(expectedEntry1LedgerIds));
  // Both halves of the reversed pair individually traceable — not collapsed into one row.
  expect((snapshot1.ledgerEntryIds as string[])).toEqual(expect.arrayContaining([adjustmentEntry.id, reversalEntry.id]));

  const [snapshot2] = await prisma.payrollSnapshot.findMany({
    where: { payrollEntryId: finalEntry2.id },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  expect(snapshot2).toBeDefined();
  // Employee 2's finalPayable never diverged (22000 stored at lock 1, 22000 recomputed at lock
  // 2, no reversal involved) — full exact match, and no `approvedFinalPayable` key at all.
  expect(snapshot2.breakdownJson).toEqual({
    baseSalary: 25000,
    bonuses: 0,
    overtime: 0,
    incentives: 0,
    advances: -3000,
    expenses: 0,
    penalties: 0,
    otherDeductions: 0,
    carryForwardIn: 0,
    finalPayable: 22000,
  });
  expect(snapshot2.breakdownJson).not.toHaveProperty('approvedFinalPayable');
  expect(snapshot2.ledgerEntryIds as string[]).toEqual([advanceE2Entry.id]);

  // ── Phase 10: every posted ledger entry for both employees now points at the correct, final entry ──
  const ledgerRowsE1 = await prisma.staffLedgerEntry.findMany({ where: { userId: driverId } });
  expect(ledgerRowsE1).toHaveLength(7);
  for (const row of ledgerRowsE1) {
    expect(row.status).toBe(LedgerEntryStatus.POSTED);
    expect(row.payrollEntryId).toBe(finalEntry1.id);
  }

  const ledgerRowsE2 = await prisma.staffLedgerEntry.findMany({ where: { userId: loaderId } });
  expect(ledgerRowsE2).toHaveLength(1);
  expect(ledgerRowsE2[0].status).toBe(LedgerEntryStatus.POSTED);
  expect(ledgerRowsE2[0].payrollEntryId).toBe(finalEntry2.id);
});

/**
 * Staff Attendance & Wage Types — Phase 3 (docs/features/staff-attendance-and-wage-types.md
 * §4). Fully isolated: its own vendor/admin/employees/period, cleaned up in its
 * own `afterAll`, so it cannot affect (or be affected by) the MONTHLY-only
 * assertions in the `it(...)` block above — adding a 3rd/4th payroll-eligible
 * employee to the SHARED vendor would break `draft1.generated`'s exact-match
 * assertion there, which is why this scenario gets a fully separate vendor.
 */
describe('DAILY / WEEKLY wage types — real-database integration (§4 Phase 3)', () => {
  let vendorId2: string;
  let adminUserId2: string;
  let dailyWorkerId: string;
  let weeklyWorkerId: string;
  let adminAuthUser2: AuthUser;

  // 20 full days + 2 half days for the DAILY worker, all inside August 2026.
  const dailyPresentDates = [
    '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
    '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
    '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22',
    '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
  ];
  const dailyHalfDates = ['2026-08-30', '2026-08-31'];
  // 3 present days for the WEEKLY worker.
  const weeklyPresentDates = ['2026-08-03', '2026-08-10', '2026-08-17'];

  beforeAll(async () => {
    const vendor2 = await prisma.vendor.create({
      data: { name: `Payroll Wage-Type ITest Vendor ${RUN_ID}`, slug: `payroll-wage-itest-${RUN_ID}` },
    });
    vendorId2 = vendor2.id;

    const admin2 = await prisma.user.create({
      data: {
        vendorId: vendorId2,
        role: UserRole.VENDOR_ADMIN,
        name: `Wage ITest Admin ${RUN_ID}`,
        email: `payroll-wage-itest-admin-${RUN_ID}@test.local`,
      },
    });
    adminUserId2 = admin2.id;
    adminAuthUser2 = {
      userId: admin2.id,
      email: admin2.email as string,
      name: admin2.name,
      role: 'VENDOR_ADMIN',
      vendorId: vendorId2,
      customerId: null,
    };

    const dailyWorker = await prisma.user.create({
      data: {
        vendorId: vendorId2,
        role: UserRole.LOADER,
        name: `Wage ITest Daily Loader ${RUN_ID}`,
        email: `payroll-wage-itest-daily-${RUN_ID}@test.local`,
      },
    });
    dailyWorkerId = dailyWorker.id;

    const weeklyWorker = await prisma.user.create({
      data: {
        vendorId: vendorId2,
        role: UserRole.LOADER,
        name: `Wage ITest Weekly Loader ${RUN_ID}`,
        email: `payroll-wage-itest-weekly-${RUN_ID}@test.local`,
      },
    });
    weeklyWorkerId = weeklyWorker.id;

    await prisma.salaryStructure.create({
      data: {
        vendorId: vendorId2,
        userId: dailyWorkerId,
        baseAmount: 1000, // daily rate
        payFrequency: PayFrequency.DAILY,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        createdById: adminUserId2,
      },
    });
    await prisma.salaryStructure.create({
      data: {
        vendorId: vendorId2,
        userId: weeklyWorkerId,
        baseAmount: 5000, // rate per 7-calendar-day week
        payFrequency: PayFrequency.WEEKLY,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        createdById: adminUserId2,
      },
    });
    await prisma.payrollVendorConfig.create({
      data: { vendorId: vendorId2, cutoffDay: 1, autoLockEnabled: false, updatedById: adminUserId2 },
    });

    for (const d of dailyPresentDates) {
      await prisma.staffAttendance.create({
        data: {
          vendorId: vendorId2,
          userId: dailyWorkerId,
          date: new Date(`${d}T00:00:00.000Z`),
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.MANUAL,
          markedById: adminUserId2,
        },
      });
    }
    for (const d of dailyHalfDates) {
      await prisma.staffAttendance.create({
        data: {
          vendorId: vendorId2,
          userId: dailyWorkerId,
          date: new Date(`${d}T00:00:00.000Z`),
          status: AttendanceStatus.HALF_DAY,
          source: AttendanceSource.MANUAL,
          markedById: adminUserId2,
        },
      });
    }
    for (const d of weeklyPresentDates) {
      await prisma.staffAttendance.create({
        data: {
          vendorId: vendorId2,
          userId: weeklyWorkerId,
          date: new Date(`${d}T00:00:00.000Z`),
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.MANUAL,
          markedById: adminUserId2,
        },
      });
    }
  });

  afterAll(async () => {
    await cleanupTestData(prisma, vendorId2);
  });

  it('resolves DAILY/WEEKLY base salary from real StaffAttendance rows, and locks unchanged through the untouched lockPeriod path', async () => {
    const period2 = await withFixedNow(() => payrollPeriodService.getOrCreateOpenPeriod(adminAuthUser2));
    expect(period2.periodLabel).toBe('2026-08');

    const draft = await payrollEntryService.generateDraft(adminAuthUser2, period2.id);
    expect(draft.generated.sort()).toEqual([dailyWorkerId, weeklyWorkerId].sort());
    expect(draft.skippedMissingSalaryStructure).toEqual([]);

    const dailyEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { periodId_userId: { periodId: period2.id, userId: dailyWorkerId } },
    });
    // (20 PRESENT + 2 x 0.5 HALF_DAY) x 1000/day = 21000. No other ledger
    // activity for this employee, so finalPayable equals baseSalary exactly.
    expect(dailyEntry.baseSalary).toBe(21000);
    expect(dailyEntry.finalPayable).toBe(21000);

    const weeklyEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { periodId_userId: { periodId: period2.id, userId: weeklyWorkerId } },
    });
    // round((5000 / 7) x 3) = round(2142.857...) = 2143.
    expect(weeklyEntry.baseSalary).toBe(2143);
    expect(weeklyEntry.finalPayable).toBe(2143);

    // Approve + lock proves the UNTOUCHED lockPeriod path (which passes the
    // already-stored entry.baseSalary through to computeEntryBreakdown
    // verbatim, never re-deriving from SalaryStructure) reproduces the exact
    // same wage-type numbers end-to-end — the C1 resolution requires zero
    // lockPeriod changes, and this proves it holds for DAILY/WEEKLY too.
    await payrollEntryService.approveEntry(adminAuthUser2, dailyEntry.id, dailyEntry.version);
    await payrollEntryService.approveEntry(adminAuthUser2, weeklyEntry.id, weeklyEntry.version);

    const lock = await payrollPeriodService.lockPeriod(adminAuthUser2, period2.id);
    expect(lock.lockedEntryCount).toBe(2);

    const dailySnapshot = await prisma.payrollSnapshot.findFirst({
      where: { payrollEntryId: dailyEntry.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(dailySnapshot?.breakdownJson).toMatchObject({ baseSalary: 21000, finalPayable: 21000 });
    expect(dailySnapshot?.breakdownJson).not.toHaveProperty('approvedFinalPayable');

    const weeklySnapshot = await prisma.payrollSnapshot.findFirst({
      where: { payrollEntryId: weeklyEntry.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(weeklySnapshot?.breakdownJson).toMatchObject({ baseSalary: 2143, finalPayable: 2143 });
  });
});
