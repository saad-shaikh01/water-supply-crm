import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayrollEntryService } from './payroll-entry.service';
import {
  AttendanceStatus,
  LedgerEntryStatus,
  PayFrequency,
  PayrollAuditAction,
  PayrollEntryStatus,
  PayrollPeriodStatus,
  StaffLedgerCategory,
} from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const PERIOD_ID = 'period-001';
const EMPLOYEE_ID = 'employee-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

const openPeriod = {
  id: PERIOD_ID,
  vendorId: VENDOR_ID,
  periodLabel: '2026-08',
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: new Date('2026-08-31T23:59:59.999Z'),
  status: PayrollPeriodStatus.OPEN,
};

const employee = { id: EMPLOYEE_ID, name: 'Ali Driver' };

const salaryStructure = {
  id: 'ss-001',
  vendorId: VENDOR_ID,
  userId: EMPLOYEE_ID,
  baseAmount: 30000,
  // Every real SalaryStructure row always has this set (NOT NULL DEFAULT
  // MONTHLY) — explicit here now that resolvePeriodBase() branches on it.
  payFrequency: PayFrequency.MONTHLY,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
};

// A deliberate mix of positive AND negative signed ledger amounts — this is
// exactly the shape of data that would expose a sign-flip bug (e.g.
// subtracting `expenses`/`advances` instead of summing them flatly).
const mixedLedgerEntries = [
  { id: 'le-1', category: StaffLedgerCategory.ADVANCE, amount: -5000 },
  { id: 'le-2', category: StaffLedgerCategory.EXPENSE_REIMBURSEMENT, amount: 2000 },
  { id: 'le-3', category: StaffLedgerCategory.BONUS, amount: 1000 },
  { id: 'le-4', category: StaffLedgerCategory.PENALTY, amount: -500 },
  { id: 'le-5', category: StaffLedgerCategory.OVERTIME, amount: 300 },
  { id: 'le-6', category: StaffLedgerCategory.INCENTIVE, amount: 700 },
  { id: 'le-7', category: StaffLedgerCategory.DEDUCTION, amount: -200 },
  { id: 'le-8', category: StaffLedgerCategory.LEAVE_PAID, amount: 100 },
];

// ─── mock tx / prisma factory ─────────────────────────────────────────────────

function makeTx(overrides: any = {}) {
  return {
    salaryStructure: {
      findMany: jest.fn().mockResolvedValue([salaryStructure]),
      // Mid-period-structure-change guard (H1): no prior overlapping
      // structure by default, so every existing MONTHLY/DAILY/WEEKLY test
      // that doesn't care about this check passes through unaffected.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    payrollEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'new-payroll-entry-001',
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    payrollEntryAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
    staffLedgerEntry: {
      findMany: jest.fn().mockResolvedValue(mixedLedgerEntries),
    },
    payrollPeriod: {
      findFirst: jest.fn().mockResolvedValue(null), // no previous period by default
    },
    settlement: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    // generateDraft() now aggregates attendance once per run regardless of any
    // employee's frequency (§4 Phase 3) — every test needs this mock to exist,
    // even MONTHLY-only ones. Empty by default: harmless, since a MONTHLY
    // employee's resolvePeriodBase() never reads the resulting map.
    staffAttendance: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    // Dual-Cutoff Payroll Flexibility (2026-09-25): a missing/null config row
    // means the cash-deduction window is disabled — every existing test (no
    // vendor has opted in) exercises the single-window fallback unaffected.
    payrollVendorConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function makeAdvancePlansMock(overrides: any = {}) {
  return {
    ensureInstallmentsForPeriod: jest.fn().mockResolvedValue(undefined),
    listForEmployeePeriod: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeService(opts: { period?: any; eligibleEmployees?: any[]; txOverrides?: any; advancePlansOverrides?: any } = {}) {
  const tx = makeTx(opts.txOverrides);
  const periodForLookup = 'period' in opts ? opts.period : openPeriod;
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    payrollPeriod: { findFirst: jest.fn().mockResolvedValue(periodForLookup) },
    user: { findMany: jest.fn().mockResolvedValue(opts.eligibleEmployees ?? [employee]) },
    payrollEntry: { findFirst: jest.fn(), findMany: jest.fn() },
    staffLedgerEntry: { findMany: jest.fn() },
  };
  const permissions = { can: jest.fn().mockResolvedValue(true) };
  const advancePlans = makeAdvancePlansMock(opts.advancePlansOverrides);

  const svc = new PayrollEntryService(prisma as any, permissions as any, advancePlans as any);
  return { svc, prisma, tx, permissions, advancePlans };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('PayrollEntryService', () => {
  describe('generateDraft() — sign convention correctness', () => {
    it('sums every bucket flatly (never subtracts) — exact finalPayable for a mix of positive and negative amounts', async () => {
      const { svc, tx } = makeService();
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.generated).toEqual([EMPLOYEE_ID]);
      expect(tx.payrollEntry.create).toHaveBeenCalledTimes(1);

      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(30000);
      expect(created.advances).toBe(-5000);
      expect(created.expenses).toBe(2000);
      expect(created.bonuses).toBe(1000);
      expect(created.penalties).toBe(-500);
      expect(created.overtime).toBe(300);
      expect(created.incentives).toBe(700);
      // DEDUCTION (-200) + LEAVE_PAID (+100) both fold into otherDeductions.
      expect(created.otherDeductions).toBe(-100);
      expect(created.carryForwardIn).toBe(0);

      // 30000 + 1000 + 300 + 700 + (-5000) + 2000 + (-500) + (-100) + 0 = 28400.
      // A subtraction-based ("fixed") implementation would instead compute
      // 30000 - (-100) or similar and diverge from this exact number.
      expect(created.finalPayable).toBe(28400);
    });

    it('a reimbursement (positive EXPENSE_REIMBURSEMENT) always adds to finalPayable, never subtracts', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffLedgerEntry: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'le-1', category: StaffLedgerCategory.EXPENSE_REIMBURSEMENT, amount: 2500 },
            ]),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.expenses).toBe(2500);
      expect(created.finalPayable).toBe(30000 + 2500);
    });

    it('a Crew Cash sync entry (CREW_CASH category) folds into otherDeductions, same bucket as DEDUCTION/ADJUSTMENT', async () => {
      // Regression test for the bucketKeyForCategory gap found while building
      // Crew Cash Distribution (Phase 3-3) — CREW_CASH previously fell
      // through the switch with no case, returning undefined.
      const { svc, tx } = makeService({
        txOverrides: {
          staffLedgerEntry: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'le-1', category: StaffLedgerCategory.CREW_CASH, amount: -150 },
            ]),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.otherDeductions).toBe(-150);
      expect(created.finalPayable).toBe(30000 - 150);
    });

    it('an ADVANCE_RECOVERY installment folds into the advances bucket, same column as a plain ADVANCE', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffLedgerEntry: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'le-1', category: StaffLedgerCategory.ADVANCE_RECOVERY, amount: -10000 },
            ]),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.advances).toBe(-10000);
      expect(created.finalPayable).toBe(30000 - 10000);
    });

    it('never fetches ADVANCE_DISBURSEMENT rows into the bucket computation at all', async () => {
      // computeLedgerContribution excludes the category outright — a loan
      // disbursement is not itself a payroll deduction. Asserting the query
      // filter (rather than feeding a disbursement row through the mock,
      // which would just reflect whatever the mock returns) is what actually
      // proves the exclusion, since the real findMany is what enforces it.
      const { svc, tx } = makeService();
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(tx.staffLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { not: StaffLedgerCategory.ADVANCE_DISBURSEMENT },
          }),
        }),
      );
    });
  });

  describe('generateDraft() — Dual-Cutoff cash-deduction window (owner-requested 2026-09-25)', () => {
    it('stays on the single attendance-period window when the vendor has no PayrollVendorConfig row (the default for every existing vendor)', async () => {
      const { svc, tx } = makeService();
      await svc.generateDraft(adminUser, PERIOD_ID);
      // A row belongs to the period by its effectiveDate — or, if it was deferred ("deduct next month"),
      // by its payrollAttributionDate instead. Nothing else: no category split when the feature is off.
      const where = tx.staffLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { payrollAttributionDate: null, effectiveDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
        { payrollAttributionDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
      ]);
      expect(where.AND).toBeUndefined();
    });

    it('stays on the single window when cashCutoffDay is set but no category has opted in (empty cashWindowCategories)', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollVendorConfig: {
            findUnique: jest.fn().mockResolvedValue({ cashCutoffDay: 10, cashWindowCategories: [] }),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const where = tx.staffLedgerEntry.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { payrollAttributionDate: null, effectiveDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
        { payrollAttributionDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
      ]);
    });

    it('splits the ledger query by category when cashCutoffDay + cashWindowCategories are both configured', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollVendorConfig: {
            findUnique: jest.fn().mockResolvedValue({
              cashCutoffDay: 10,
              cashWindowCategories: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.CREW_CASH],
            }),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const where = tx.staffLedgerEntry.findMany.mock.calls[0][0].where;

      // openPeriod.endDate is 2026-08-31 (attendance period is calendar-month
      // August); the cash cutoff (10th) cycle containing that date runs
      // 2026-08-10 -> 2026-09-09 — the exact "advances/crew cash cut off
      // around the 10th, ahead of a 10th-of-next-month release" scenario.
      const cashRange = { gte: new Date('2026-08-10T00:00:00.000Z'), lte: new Date('2026-09-09T23:59:59.999Z') };
      const periodRange = { gte: openPeriod.startDate, lte: openPeriod.endDate };
      const attributed = (range: { gte: Date; lte: Date }) => ({
        OR: [{ payrollAttributionDate: null, effectiveDate: range }, { payrollAttributionDate: range }],
      });
      expect(where.OR).toEqual([
        { AND: [{ category: { in: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.CREW_CASH] } }, attributed(cashRange)] },
        { AND: [{ category: { notIn: [StaffLedgerCategory.ADVANCE, StaffLedgerCategory.CREW_CASH] } }, attributed(periodRange)] },
      ]);
      // ADVANCE_DISBURSEMENT stays hard-excluded regardless of the window split.
      expect(where.category).toEqual({ not: StaffLedgerCategory.ADVANCE_DISBURSEMENT });
    });

    it('still sums whatever the (now window-split) query returns into the correct buckets', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollVendorConfig: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ cashCutoffDay: 10, cashWindowCategories: [StaffLedgerCategory.ADVANCE] }),
          },
          staffLedgerEntry: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'le-1', category: StaffLedgerCategory.ADVANCE, amount: -8000 },
              { id: 'le-2', category: StaffLedgerCategory.BONUS, amount: 1500 },
            ]),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.advances).toBe(-8000);
      expect(created.bonuses).toBe(1500);
      expect(created.finalPayable).toBe(30000 - 8000 + 1500);
    });
  });

  describe('generateDraft() — Advance Installments auto-generation', () => {
    it('calls ensureInstallmentsForPeriod once per generated employee, inside the same transaction', async () => {
      const { svc, tx, advancePlans } = makeService();
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(advancePlans.ensureInstallmentsForPeriod).toHaveBeenCalledTimes(1);
      expect(advancePlans.ensureInstallmentsForPeriod).toHaveBeenCalledWith(tx, VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
    });

    it('still runs for a regenerated (still-DRAFT) entry', async () => {
      const { svc, advancePlans, tx } = makeService({
        txOverrides: {
          payrollEntry: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'existing-001',
              status: PayrollEntryStatus.DRAFT,
              baseSalary: 30000,
              finalPayable: 30000,
            }),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(tx.payrollEntry.update).toHaveBeenCalledTimes(1);
      expect(advancePlans.ensureInstallmentsForPeriod).toHaveBeenCalledTimes(1);
    });

    it('does NOT run for an employee skipped for missing a SalaryStructure', async () => {
      const { svc, advancePlans } = makeService({
        txOverrides: { salaryStructure: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) } },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);
      expect(result.skippedMissingSalaryStructure).toHaveLength(1);
      expect(advancePlans.ensureInstallmentsForPeriod).not.toHaveBeenCalled();
    });
  });

  describe('generateDraft() — negative finalPayable is not clamped', () => {
    it('keeps finalPayable negative when debits exceed baseSalary', async () => {
      const smallSalaryStructure = { ...salaryStructure, baseAmount: 1000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([smallSalaryStructure]) },
          staffLedgerEntry: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'le-1', category: StaffLedgerCategory.PENALTY, amount: -5000 },
            ]),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.finalPayable).toBe(-4000);
    });
  });

  describe('generateDraft() — DAILY / WEEKLY wage types (§4 Phase 3)', () => {
    function groupByRows(rows: Array<{ userId: string; status: AttendanceStatus; count: number }>) {
      return rows.map((r) => ({ userId: r.userId, status: r.status, _count: { _all: r.count } }));
    }

    it('MONTHLY stays byte-identical even when the aggregated attendance map has rows for this employee', async () => {
      // The single most important regression guard: generateDraft() now always
      // aggregates attendance once per run, but a MONTHLY employee's base must
      // never read it — prove that even when attendance data EXISTS for them,
      // baseSalary/finalPayable are the exact same numbers as the MONTHLY-only
      // tests above.
      const { svc, tx } = makeService({
        txOverrides: {
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 3 }]),
            ),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);
      expect(result.generated).toEqual([EMPLOYEE_ID]);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(30000);
      // Same mixedLedgerEntries fixture as the very first test in this file.
      expect(created.finalPayable).toBe(28400);
    });

    it('DAILY: base = dailyRate x attended PRESENT days', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([dailyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 20 }]),
            ),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(20000); // 1000 x 20
      expect(created.finalPayable).toBe(20000);
    });

    it('DAILY: HALF_DAY rows contribute half a unit each, alongside full PRESENT days', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([dailyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([
                { userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 20 },
                { userId: EMPLOYEE_ID, status: AttendanceStatus.HALF_DAY, count: 2 },
              ]),
            ),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      // (20 + 0.5*2) x 1000 = 21000
      expect(created.baseSalary).toBe(21000);
    });

    it('WEEKLY: base = round((weeklyRate / 7) x attended units) — a fixed 7-day conversion, not a working-days policy divisor', async () => {
      const weeklyStructure = { ...salaryStructure, payFrequency: PayFrequency.WEEKLY, baseAmount: 5000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([weeklyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 3 }]),
            ),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      // 5000 / 7 = 714.2857... x 3 = 2142.857... -> rounds to 2143 (single
      // rounding at the end, never per-day).
      expect(created.baseSalary).toBe(2143);
    });

    it('DAILY employee with zero attendance rows gets baseSalary 0 — never defaulted to full pay', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([dailyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          // No rows for this employee at all.
          staffAttendance: { groupBy: jest.fn().mockResolvedValue([]) },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);
      // Still generated — a missing attendance record is not the same as a
      // missing SalaryStructure (that path is skippedMissingSalaryStructure).
      expect(result.generated).toEqual([EMPLOYEE_ID]);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(0);
    });

    it('attendance rows belonging to a different employee never leak into this one\'s count', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([dailyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([
                { userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 5 },
                { userId: 'someone-else-002', status: AttendanceStatus.PRESENT, count: 25 },
              ]),
            ),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(5000); // 1000 x 5, not x30
    });

    it('aggregateAttendance queries only PRESENT/HALF_DAY rows for this vendor, dated within the period', async () => {
      const { svc, tx } = makeService();
      await svc.generateDraft(adminUser, PERIOD_ID);

      expect(tx.staffAttendance.groupBy).toHaveBeenCalledTimes(1);
      expect(tx.staffAttendance.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['userId', 'status'],
          where: expect.objectContaining({
            vendorId: VENDOR_ID,
            date: { gte: openPeriod.startDate, lte: openPeriod.endDate },
            status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.HALF_DAY] },
          }),
        }),
      );
    });

    it('regenerating a still-DRAFT DAILY entry re-derives base from current attendance (not the stale generate-time count)', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 };
      const existingDraft = {
        id: 'entry-001',
        status: PayrollEntryStatus.DRAFT,
        baseSalary: 5000,
        finalPayable: 5000,
      };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: { findMany: jest.fn().mockResolvedValue([dailyStructure]), findFirst: jest.fn().mockResolvedValue(null) },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          payrollEntry: {
            findUnique: jest.fn().mockResolvedValue(existingDraft),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
            create: jest.fn(),
          },
          staffAttendance: {
            // Attendance grew since the first generate (5 -> 12 present days).
            groupBy: jest.fn().mockResolvedValue(
              groupByRows([{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, count: 12 }]),
            ),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);
      expect(result.regenerated).toEqual([EMPLOYEE_ID]);
      const updated = tx.payrollEntry.update.mock.calls[0][0].data;
      expect(updated.baseSalary).toBe(12000);
    });
  });

  describe('generateDraft() — mid-period SalaryStructure change (merge-review finding H1)', () => {
    it('flags a mid-period MONTHLY -> DAILY switch as a data error instead of applying the new rate to the whole period', async () => {
      const dailyStructure = { ...salaryStructure, id: 'ss-002', payFrequency: PayFrequency.DAILY, baseAmount: 1000, effectiveFrom: new Date('2026-08-16') };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: {
            findMany: jest.fn().mockResolvedValue([dailyStructure]),
            // A prior MONTHLY row was still effective for the first half of August.
            findFirst: jest.fn().mockResolvedValue({
              id: 'ss-001', payFrequency: PayFrequency.MONTHLY, effectiveTo: new Date('2026-08-15'),
            }),
          },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              [{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, _count: { _all: 30 } }],
            ),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.generated).toEqual([]);
      expect(tx.payrollEntry.create).not.toHaveBeenCalled();
      expect(result.skippedDataError).toHaveLength(1);
      expect(result.skippedDataError[0].userId).toBe(EMPLOYEE_ID);
      expect(result.skippedDataError[0].reason).toMatch(/mid-period/i);
      expect(result.skippedDataError[0].reason).toMatch(/MONTHLY to DAILY/);
    });

    it('flags a mid-period DAILY-rate change the same way (non-MONTHLY -> non-MONTHLY)', async () => {
      const newDailyStructure = { ...salaryStructure, id: 'ss-003', payFrequency: PayFrequency.DAILY, baseAmount: 1200, effectiveFrom: new Date('2026-08-16') };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: {
            findMany: jest.fn().mockResolvedValue([newDailyStructure]),
            findFirst: jest.fn().mockResolvedValue({
              id: 'ss-002', payFrequency: PayFrequency.DAILY, effectiveTo: new Date('2026-08-15'),
            }),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);
      expect(tx.payrollEntry.create).not.toHaveBeenCalled();
      expect(result.skippedDataError).toHaveLength(1);
    });

    it('does NOT flag a MONTHLY employee whose rate changed mid-period — MONTHLY keeps its existing, documented "whole period gets the new flat rate" behavior unchanged', async () => {
      const raisedStructure = { ...salaryStructure, id: 'ss-002', payFrequency: PayFrequency.MONTHLY, baseAmount: 35000, effectiveFrom: new Date('2026-08-16') };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: {
            findMany: jest.fn().mockResolvedValue([raisedStructure]),
            // Guard is gated on payFrequency !== MONTHLY, so this should never
            // even be consulted for a MONTHLY employee — but seed it as if a
            // prior row existed anyway, to prove the MONTHLY path ignores it.
            findFirst: jest.fn().mockResolvedValue({
              id: 'ss-001', payFrequency: PayFrequency.MONTHLY, effectiveTo: new Date('2026-08-15'),
            }),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.skippedDataError).toEqual([]);
      expect(tx.payrollEntry.create).toHaveBeenCalledTimes(1);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(35000);
    });

    it('does not flag a DAILY employee whose structure covered the whole period cleanly (no prior overlap)', async () => {
      const dailyStructure = { ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000, effectiveFrom: new Date('2026-01-01') };
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: {
            findMany: jest.fn().mockResolvedValue([dailyStructure]),
            findFirst: jest.fn().mockResolvedValue(null), // no prior overlapping row
          },
          staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
          staffAttendance: {
            groupBy: jest.fn().mockResolvedValue(
              [{ userId: EMPLOYEE_ID, status: AttendanceStatus.PRESENT, _count: { _all: 20 } }],
            ),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.skippedDataError).toEqual([]);
      expect(tx.payrollEntry.create).toHaveBeenCalledTimes(1);
      const created = tx.payrollEntry.create.mock.calls[0][0].data;
      expect(created.baseSalary).toBe(20000);
    });
  });

  describe('generateDraft() — missing SalaryStructure exclusion', () => {
    it('excludes the employee and reports skippedMissingSalaryStructure instead of defaulting to 0', async () => {
      const { svc, tx } = makeService({
        txOverrides: { salaryStructure: { findMany: jest.fn().mockResolvedValue([]) } },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.skippedMissingSalaryStructure).toEqual([{ userId: EMPLOYEE_ID, name: employee.name }]);
      expect(result.generated).toEqual([]);
      expect(tx.payrollEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('generateDraft() — overlapping SalaryStructure data error', () => {
    it('excludes the employee with a loud dataError reason rather than picking one arbitrarily', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          salaryStructure: {
            findMany: jest.fn().mockResolvedValue([salaryStructure, { ...salaryStructure, id: 'ss-002' }]),
          },
        },
      });
      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.skippedDataError).toHaveLength(1);
      expect(result.skippedDataError[0].userId).toBe(EMPLOYEE_ID);
      expect(result.skippedDataError[0].reason).toMatch(/overlapping/i);
      expect(tx.payrollEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('generateDraft() — regenerate skips already-reviewed entries', () => {
    it('leaves an APPROVED entry untouched and reports it as skippedAlreadyReviewed', async () => {
      const existingApproved = {
        id: 'entry-001',
        periodId: PERIOD_ID,
        userId: EMPLOYEE_ID,
        status: PayrollEntryStatus.APPROVED,
        baseSalary: 30000,
        finalPayable: 30000,
      };
      const { svc, tx } = makeService({
        txOverrides: { payrollEntry: { ...makeTx().payrollEntry, findUnique: jest.fn().mockResolvedValue(existingApproved) } },
      });

      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.skippedAlreadyReviewed).toEqual([
        { userId: EMPLOYEE_ID, name: employee.name, status: PayrollEntryStatus.APPROVED },
      ]);
      expect(result.generated).toEqual([]);
      expect(result.regenerated).toEqual([]);
      expect(tx.payrollEntry.update).not.toHaveBeenCalled();
      expect(tx.payrollEntry.create).not.toHaveBeenCalled();
    });

    it('regenerates a still-DRAFT entry and writes a REGENERATED audit row', async () => {
      const existingDraft = {
        id: 'entry-001',
        periodId: PERIOD_ID,
        userId: EMPLOYEE_ID,
        status: PayrollEntryStatus.DRAFT,
        baseSalary: 30000,
        finalPayable: 30000,
      };
      const { svc, tx } = makeService({
        txOverrides: { payrollEntry: { ...makeTx().payrollEntry, findUnique: jest.fn().mockResolvedValue(existingDraft) } },
      });

      const result = await svc.generateDraft(adminUser, PERIOD_ID);

      expect(result.regenerated).toEqual([EMPLOYEE_ID]);
      expect(tx.payrollEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'entry-001' } }),
      );
      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: PayrollAuditAction.REGENERATED }) }),
      );
    });
  });

  describe('generateDraft() — period status guard', () => {
    it('throws NotFoundException when the period does not belong to this vendor', async () => {
      const { svc } = makeService({ period: null });
      await expect(svc.generateDraft(adminUser, PERIOD_ID)).rejects.toThrow(NotFoundException);
    });

    it('rejects generating entries for a LOCKED period', async () => {
      const { svc } = makeService({ period: { ...openPeriod, status: PayrollPeriodStatus.LOCKED } });
      await expect(svc.generateDraft(adminUser, PERIOD_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveEntry()', () => {
    it('approves a DRAFT entry via atomic CAS', async () => {
      const { svc, tx } = makeService();
      const draftEntry = { id: 'entry-001', vendorId: VENDOR_ID, userId: EMPLOYEE_ID, status: PayrollEntryStatus.DRAFT, version: 0, period: openPeriod };
      tx.payrollEntry.findFirst.mockResolvedValue(draftEntry);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });
      tx.payrollEntry.findUniqueOrThrow.mockResolvedValue({ ...draftEntry, status: PayrollEntryStatus.APPROVED, version: 1 });

      const result = await svc.approveEntry(adminUser, 'entry-001', 0);
      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc, tx } = makeService();
      const draftEntry = { id: 'entry-001', vendorId: VENDOR_ID, userId: EMPLOYEE_ID, status: PayrollEntryStatus.DRAFT, version: 0, period: openPeriod };
      tx.payrollEntry.findFirst.mockResolvedValue(draftEntry);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(svc.approveEntry(adminUser, 'entry-001', 99)).rejects.toThrow(ConflictException);
    });

    it('rejects approving a non-DRAFT entry', async () => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findFirst.mockResolvedValue({
        id: 'entry-001',
        vendorId: VENDOR_ID,
        status: PayrollEntryStatus.APPROVED,
        version: 1,
      });
      await expect(svc.approveEntry(adminUser, 'entry-001', 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveEntry() - pending absence decisions gate', () => {
    const draftEntry = {
      id: 'entry-001',
      vendorId: VENDOR_ID,
      userId: EMPLOYEE_ID,
      status: PayrollEntryStatus.DRAFT,
      version: 0,
      period: openPeriod,
    };
    function setup(pendingCount: number, payFrequency: PayFrequency = PayFrequency.MONTHLY) {
      const made = makeService();
      made.tx.payrollEntry.findFirst.mockResolvedValue(draftEntry);
      made.tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });
      made.tx.payrollEntry.findUniqueOrThrow.mockResolvedValue({ ...draftEntry, status: PayrollEntryStatus.APPROVED, version: 1 });
      made.tx.salaryStructure.findMany.mockResolvedValue([{ userId: EMPLOYEE_ID, payFrequency }]);
      made.tx.staffAttendance.groupBy.mockResolvedValue(pendingCount > 0 ? [{ userId: EMPLOYEE_ID, _count: { _all: pendingCount } }] : []);
      return made;
    }

    it('refuses with code PENDING_ABSENCE_DECISIONS (and writes nothing) while absent days are undecided', async () => {
      const { svc, tx } = setup(3);
      const err: any = await svc.approveEntry(adminUser, 'entry-001', 0).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'PENDING_ABSENCE_DECISIONS', pendingAbsenceDays: 3 });
      expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
    });

    it('queries only undecided Absent/Half-day days: no live deduction, not waived, inside the period', async () => {
      const { svc, tx } = setup(1);
      await svc.approveEntry(adminUser, 'entry-001', 0).catch(() => undefined);
      expect(tx.staffAttendance.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            vendorId: VENDOR_ID,
            userId: { in: [EMPLOYEE_ID] },
            date: { gte: openPeriod.startDate, lte: openPeriod.endDate },
            status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
            deductionWaivedAt: null,
            OR: [{ leaveLedgerEntryId: null }, { leaveLedgerEntry: { status: LedgerEntryStatus.VOIDED } }],
          }),
        }),
      );
    });

    it('approves when the caller acknowledges the undecided days', async () => {
      const { svc, tx } = setup(3);
      const result = await svc.approveEntry(adminUser, 'entry-001', 0, true);
      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
      expect(tx.staffAttendance.groupBy).not.toHaveBeenCalled();
    });

    it('approves straight away when nothing is undecided', async () => {
      const { svc } = setup(0);
      const result = await svc.approveEntry(adminUser, 'entry-001', 0);
      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
    });

    it('never gates a DAILY/WEEKLY employee - an absence is already unpaid by construction there', async () => {
      const { svc } = setup(5, PayFrequency.DAILY);
      const result = await svc.approveEntry(adminUser, 'entry-001', 0);
      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
    });
  });

  describe('generateDraft() - max-deduction ceiling (PayrollVendorConfig.maxDeductionPercent)', () => {
    // mixedLedgerEntries: advances -5000, penalties -500, otherDeductions -200+100 = -100 => net deduction 5600.
    // Everything else: +2000 expenses, +1000 bonus, +300 overtime, +700 incentive; base 30000.
    // No ceiling: 30000 + 4000 - 5600 = 28400 (the sign-convention test above).
    function ceilingService(opts: { pct?: number | null; previousDeferredOut?: number; previousFinalPayable?: number }) {
      const previous = opts.previousDeferredOut !== undefined || opts.previousFinalPayable !== undefined;
      return makeService({
        txOverrides: {
          payrollVendorConfig: {
            findUnique: jest.fn().mockResolvedValue(opts.pct == null ? null : { cashCutoffDay: null, cashWindowCategories: [], maxDeductionPercent: opts.pct }),
          },
          payrollPeriod: {
            findFirst: jest.fn().mockResolvedValue(previous ? { id: 'prev-period', endDate: new Date('2026-07-31T23:59:59.999Z') } : null),
          },
          payrollEntry: {
            findUnique: jest
              .fn()
              .mockImplementation(async ({ where }: any) =>
                where.periodId_userId?.periodId === 'prev-period'
                  ? { id: 'prev-entry', finalPayable: opts.previousFinalPayable ?? 0, deferredOut: opts.previousDeferredOut ?? 0 }
                  : null,
              ),
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', version: 0, ...data })),
            update: jest.fn(),
            updateMany: jest.fn(),
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
          },
        },
      });
    }
    const created = (tx: any) => tx.payrollEntry.create.mock.calls[0][0].data;

    it('is a strict no-op when the ceiling is off (null) - finalPayable identical to the pre-ceiling formula', async () => {
      const { svc, tx } = ceilingService({ pct: null });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ finalPayable: 28400, deferredIn: 0, deferredOut: 0 });
    });

    it('does nothing when deductions are within the ceiling', async () => {
      // 30% of 30000 = 9000 >= 5600 owed.
      const { svc, tx } = ceilingService({ pct: 30 });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ finalPayable: 28400, deferredOut: 0 });
    });

    it('charges only up to the ceiling and pushes the rest to deferredOut (not lost)', async () => {
      // 10% of 30000 = 3000 allowed; 5600 owed => 2600 deferred. Pay = 30000+4000-3000 = 31000.
      const { svc, tx } = ceilingService({ pct: 10 });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ finalPayable: 31000, deferredOut: 2600, deferredIn: 0 });
      // The stored buckets still show the FULL deductions that were posted - the ceiling changes what is charged, not what was recorded.
      expect(created(tx)).toMatchObject({ advances: -5000, penalties: -500, otherDeductions: -100 });
    });

    it('charges last period deferredOut as deferredIn - through the SAME ceiling again', async () => {
      // owed = 5600 + 2600 = 8200; ceiling 10% = 3000 => allowed 3000, deferredOut 5200.
      const { svc, tx } = ceilingService({ pct: 10, previousDeferredOut: 2600, previousFinalPayable: 0 });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ deferredIn: 2600, deferredOut: 5200, finalPayable: 31000 });
    });

    it('collects the whole backlog at once if the vendor later turns the ceiling off (never stranded)', async () => {
      // No ceiling: owed 5600 + 2600 deferredIn = 8200. Pay = 30000+4000-8200 = 25800.
      const { svc, tx } = ceilingService({ pct: null, previousDeferredOut: 2600, previousFinalPayable: 0 });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ deferredIn: 2600, deferredOut: 0, finalPayable: 25800 });
    });

    it('keeps the previous carry-forward separate from deferredIn (carry = prior finalPayable - settled; deferredOut is not in it)', async () => {
      const { svc, tx } = ceilingService({ pct: 10, previousDeferredOut: 2600, previousFinalPayable: 500 });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(created(tx)).toMatchObject({ carryForwardIn: 500, deferredIn: 2600, finalPayable: 31500 });
    });
  });

  describe('generateDraft() - max-deduction ceiling: edge cases', () => {
    it('picks up a held-back deduction across a GAP - the previous period has no entry for this employee, an older one does', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue({ cashCutoffDay: null, cashWindowCategories: [], maxDeductionPercent: 10 }) },
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'prev-period', endDate: new Date('2026-07-31T23:59:59.999Z') }) },
          payrollEntry: {
            // no entry in the immediately preceding period (employee had no salary structure that month)...
            findUnique: jest.fn().mockResolvedValue(null),
            // ...but the latest entry the employee DOES have still holds back 700.
            findFirst: jest.fn().mockResolvedValue({ deferredOut: 700 }),
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', version: 0, ...data })),
            update: jest.fn(),
            updateMany: jest.fn(),
            findUniqueOrThrow: jest.fn(),
          },
        },
      });
      await svc.generateDraft(adminUser, PERIOD_ID);
      const data = tx.payrollEntry.create.mock.calls[0][0].data;
      // owed = 5600 + 700; ceiling 10% of 30000 = 3000 => allowed 3000, held back 3300. carry stays 0 (existing rule).
      expect(data).toMatchObject({ carryForwardIn: 0, deferredIn: 700, deferredOut: 3300, finalPayable: 31000 });
      expect(tx.payrollEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: VENDOR_ID, userId: EMPLOYEE_ID, period: { endDate: { lt: openPeriod.startDate } } } }),
      );
    });

    it('does not even look further back for the vendor\'s very first period (no earlier period can exist)', async () => {
      const { svc, tx } = makeService(); // payrollPeriod.findFirst -> null by default
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(tx.payrollEntry.findFirst).not.toHaveBeenCalled();
    });

    it('reads the vendor config ONCE per transaction no matter how many employees are computed', async () => {
      const employees = [1, 2, 3, 4, 5].map((n) => ({ id: `emp-${n}`, name: `Emp ${n}` }));
      const { svc, tx } = makeService({ eligibleEmployees: employees });
      await svc.generateDraft(adminUser, PERIOD_ID);
      expect(tx.payrollEntry.create).toHaveBeenCalledTimes(5);
      expect(tx.payrollVendorConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('does not leak the cached config between two separate transactions (a settings change is seen by the next run)', async () => {
      const first = makeService();
      await first.svc.generateDraft(adminUser, PERIOD_ID);
      await first.svc.generateDraft(adminUser, PERIOD_ID);
      // generateDraft opens a fresh $transaction (a fresh tx object) each run => one read per run.
      expect(first.prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshDraftEntryTx() - keeps ONE employee DRAFT in step with a decision, in the caller transaction', () => {
    const draft = {
      id: 'entry-001',
      vendorId: VENDOR_ID,
      userId: EMPLOYEE_ID,
      status: PayrollEntryStatus.DRAFT,
      version: 4,
      baseSalary: 30000,
      finalPayable: 30000,
    };

    it('recomputes the ledger-derived numbers from the stored base, bumps version, audits REGENERATED, and reports true', async () => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findUnique.mockResolvedValue(draft);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });

      const refreshed = await svc.refreshDraftEntryTx(tx as any, adminUser, EMPLOYEE_ID, openPeriod as any);

      expect(refreshed).toBe(true);
      // mixedLedgerEntries => 28400 (see the sign-convention test); base is the STORED 30000, never re-derived.
      expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'entry-001', vendorId: VENDOR_ID, status: PayrollEntryStatus.DRAFT, version: 4 },
        data: expect.objectContaining({ finalPayable: 28400, deferredIn: 0, deferredOut: 0, version: { increment: 1 } }),
      });
      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payrollEntryId: 'entry-001',
          action: PayrollAuditAction.REGENERATED,
          beforeJson: { finalPayable: 30000 },
          afterJson: { finalPayable: 28400 },
        }),
      });
    });

    it.each([
      PayrollEntryStatus.APPROVED,
      PayrollEntryStatus.UNDER_REVIEW,
      PayrollEntryStatus.LOCKED,
      PayrollEntryStatus.SETTLED,
    ])('never touches a %s entry (only a DRAFT is refreshed)', async (status) => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findUnique.mockResolvedValue({ ...draft, status });
      expect(await svc.refreshDraftEntryTx(tx as any, adminUser, EMPLOYEE_ID, openPeriod as any)).toBe(false);
      expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
      expect(tx.payrollEntryAuditLog.create).not.toHaveBeenCalled();
    });

    it('is a no-op when the employee has no entry for the period, or the entry belongs to another vendor', async () => {
      const none = makeService();
      none.tx.payrollEntry.findUnique.mockResolvedValue(null);
      expect(await none.svc.refreshDraftEntryTx(none.tx as any, adminUser, EMPLOYEE_ID, openPeriod as any)).toBe(false);

      const foreign = makeService();
      foreign.tx.payrollEntry.findUnique.mockResolvedValue({ ...draft, vendorId: 'someone-else' });
      expect(await foreign.svc.refreshDraftEntryTx(foreign.tx as any, adminUser, EMPLOYEE_ID, openPeriod as any)).toBe(false);
      expect(foreign.tx.payrollEntry.updateMany).not.toHaveBeenCalled();
    });

    it('409s - so the surrounding decision rolls back - if the draft changed under it', async () => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findUnique.mockResolvedValue(draft);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.refreshDraftEntryTx(tx as any, adminUser, EMPLOYEE_ID, openPeriod as any)).rejects.toThrow(ConflictException);
      expect(tx.payrollEntryAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('listForPeriod() - undecided absence days per row', () => {
    it('reports pendingAbsenceDays for MONTHLY employees only', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollPeriod.findFirst.mockResolvedValue(openPeriod);
      prisma.payrollEntry.findMany.mockResolvedValue([
        { id: 'e1', userId: 'u-monthly', updatedAt: new Date(), user: { id: 'u-monthly', name: 'M', role: 'DRIVER' } },
        { id: 'e2', userId: 'u-daily', updatedAt: new Date(), user: { id: 'u-daily', name: 'D', role: 'DRIVER' } },
      ]);
      (prisma as any).staffAttendance = {
        groupBy: jest.fn().mockImplementation(async ({ where }: any) =>
          where.status
            ? [
                { userId: 'u-monthly', _count: { _all: 4 } },
                { userId: 'u-daily', _count: { _all: 9 } },
              ]
            : [],
        ),
      };
      (prisma as any).salaryStructure = {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u-monthly', payFrequency: PayFrequency.MONTHLY },
          { userId: 'u-daily', payFrequency: PayFrequency.DAILY },
        ]),
      };
      (prisma as any).staffAdvanceInstallment = { findMany: jest.fn().mockResolvedValue([]) };
      (prisma as any).staffLedgerEntry = { groupBy: jest.fn().mockResolvedValue([]) };
      (prisma as any).settlement = { groupBy: jest.fn().mockResolvedValue([]) };

      const rows: any[] = await svc.listForPeriod(adminUser, PERIOD_ID);
      expect(rows.find((r: any) => r.userId === 'u-monthly')!.pendingAbsenceDays).toBe(4);
      expect(rows.find((r: any) => r.userId === 'u-daily')!.pendingAbsenceDays).toBe(0);
    });
  });

  describe('recalculateEntry()', () => {
    const approvedEntry = {
      id: 'entry-001',
      vendorId: VENDOR_ID,
      userId: EMPLOYEE_ID,
      status: PayrollEntryStatus.APPROVED,
      version: 1,
      baseSalary: 30000,
      finalPayable: 28400,
      period: openPeriod,
    };

    it('refreshes an APPROVED entry from the live ledger via atomic CAS, leaving status untouched', async () => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findFirst.mockResolvedValue(approvedEntry);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });
      // mixedLedgerEntries (makeTx default) sums to the same 28400 exercised in the
      // sign-convention test above — a NEW advance ledger row landing after approval
      // is exactly the real-world case this recompute exists to pick up.
      tx.payrollEntry.findUniqueOrThrow.mockResolvedValue({ ...approvedEntry, finalPayable: 28400, version: 2 });

      const result = await svc.recalculateEntry(adminUser, 'entry-001', 1);

      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
      expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'entry-001', vendorId: VENDOR_ID, version: 1 },
          data: expect.objectContaining({
            advances: -5000,
            finalPayable: 28400,
            version: { increment: 1 },
          }),
        }),
      );
      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: PayrollAuditAction.REGENERATED,
            beforeJson: { finalPayable: 28400 },
          }),
        }),
      );
    });

    it('also allows recalculating an UNDER_REVIEW entry', async () => {
      const { svc, tx } = makeService();
      const underReview = { ...approvedEntry, status: PayrollEntryStatus.UNDER_REVIEW };
      tx.payrollEntry.findFirst.mockResolvedValue(underReview);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });
      tx.payrollEntry.findUniqueOrThrow.mockResolvedValue({ ...underReview, version: 2 });

      await expect(svc.recalculateEntry(adminUser, 'entry-001', 1)).resolves.toBeDefined();
    });

    it('throws ConflictException on stale version', async () => {
      const { svc, tx } = makeService();
      tx.payrollEntry.findFirst.mockResolvedValue(approvedEntry);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(svc.recalculateEntry(adminUser, 'entry-001', 99)).rejects.toThrow(ConflictException);
    });

    it.each([PayrollEntryStatus.DRAFT, PayrollEntryStatus.LOCKED, PayrollEntryStatus.SETTLED])(
      'rejects recalculating a %s entry',
      async (status) => {
        const { svc, tx } = makeService();
        tx.payrollEntry.findFirst.mockResolvedValue({ ...approvedEntry, status });
        await expect(svc.recalculateEntry(adminUser, 'entry-001', 1)).rejects.toThrow(BadRequestException);
      },
    );
  });

  describe('getBreakdown()', () => {
    function makeBreakdownService(canViewAll = true, entryOverrides: any = {}, advancePlansOverrides: any = {}) {
      const prisma = {
        payrollEntry: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'entry-001',
            vendorId: VENDOR_ID,
            userId: EMPLOYEE_ID,
            periodId: PERIOD_ID,
            period: openPeriod,
            ...entryOverrides,
          }),
        },
        staffLedgerEntry: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'le-1', category: StaffLedgerCategory.BONUS, amount: 1000, effectiveDate: new Date(), reversalEntries: [] },
            { id: 'le-2', category: StaffLedgerCategory.ADVANCE, amount: -500, effectiveDate: new Date(), reversalEntries: [] },
          ]),
        },
        staffAttendance: { findMany: jest.fn().mockResolvedValue([]) },
        salaryStructure: { findFirst: jest.fn().mockResolvedValue(null) },
        payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const permissions = { can: jest.fn().mockResolvedValue(canViewAll) };
      const advancePlans = makeAdvancePlansMock(advancePlansOverrides);
      const svc = new PayrollEntryService(prisma as any, permissions as any, advancePlans as any);
      return { svc, prisma, permissions, advancePlans };
    }

    it('buckets ledger entries by category and returns the entry', async () => {
      const { svc, prisma } = makeBreakdownService();
      const result = await svc.getBreakdown(adminUser, 'entry-001');

      expect(result.ledgerEntriesByBucket.bonuses).toHaveLength(1);
      expect(result.ledgerEntriesByBucket.advances).toHaveLength(1);
      expect(prisma.staffLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: LedgerEntryStatus.POSTED,
            OR: [
              { payrollAttributionDate: null, effectiveDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
              { payrollAttributionDate: { gte: openPeriod.startDate, lte: openPeriod.endDate } },
            ],
          }),
        }),
      );
    });

    it('throws NotFoundException when the entry does not belong to this vendor', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.payrollEntry.findFirst.mockResolvedValue(null);
      await expect(svc.getBreakdown(adminUser, 'entry-001')).rejects.toThrow(NotFoundException);
    });

    // ── Advance Installments additions (2026-09-24) ─────────────────────────

    it('excludes an ADVANCE_DISBURSEMENT row from ledgerEntriesByBucket (fetched for display only, never bucketed)', async () => {
      const { svc, prisma } = makeBreakdownService(true, {}, {});
      prisma.staffLedgerEntry.findMany.mockResolvedValue([
        { id: 'le-1', category: StaffLedgerCategory.BONUS, amount: 1000, effectiveDate: new Date(), reversalEntries: [] },
        { id: 'le-2', category: StaffLedgerCategory.ADVANCE_DISBURSEMENT, amount: -50000, effectiveDate: new Date(), reversalEntries: [] },
      ]);
      const result = await svc.getBreakdown(adminUser, 'entry-001');
      expect(result.ledgerEntriesByBucket.bonuses).toHaveLength(1);
      expect(result.ledgerEntriesByBucket.advances).toHaveLength(0);
    });

    it('summarizes attendance counts for the entry\'s employee and period, plus unmarked days', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.staffAttendance.findMany.mockResolvedValue([
        { date: new Date('2026-08-01'), status: AttendanceStatus.PRESENT, note: null, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null, category: null },
        { date: new Date('2026-08-02'), status: AttendanceStatus.ABSENT, note: null, leaveLedgerEntryId: 'le-9', leaveLedgerEntry: { status: LedgerEntryStatus.POSTED, amount: -1000 }, deductionWaivedAt: null, category: null },
        { date: new Date('2026-08-03'), status: AttendanceStatus.HALF_DAY, note: null, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null, category: null },
        { date: new Date('2026-08-04'), status: AttendanceStatus.LEAVE, note: null, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null, category: null },
        { date: new Date('2026-08-05'), status: AttendanceStatus.WEEKLY_OFF, note: null, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null, category: null },
      ]);
      const result = await svc.getBreakdown(adminUser, 'entry-001');
      expect(result.attendance.presentDays).toBe(1);
      expect(result.attendance.absentDays).toBe(1);
      expect(result.attendance.halfDays).toBe(1);
      expect(result.attendance.leaveDays).toBe(1);
      expect(result.attendance.weeklyOffDays).toBe(1);
      // openPeriod spans 2026-08-01..2026-08-31 = 31 days; 5 marked, 26 unmarked.
      expect(result.attendance.periodDayCount).toBe(31);
      expect(result.attendance.unmarkedDays).toBe(26);
      expect(result.attendance.days[1].hasDeduction).toBe(true);
      expect(result.attendance.days[0].hasDeduction).toBe(false);
    });

    it('classifies every Absent/Half-day as DEDUCTED / WAIVED / PENDING - a VOIDED deduction counts as undecided again; non-unpaid statuses have no decision', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.salaryStructure.findFirst.mockResolvedValue({ ...salaryStructure, payFrequency: PayFrequency.MONTHLY });
      const base = { note: null, category: null, deductionWaivedReason: null };
      prisma.staffAttendance.findMany.mockResolvedValue([
        { ...base, date: new Date('2026-08-01'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: 'le-1', leaveLedgerEntry: { status: LedgerEntryStatus.POSTED, amount: -1000 }, deductionWaivedAt: null },
        { ...base, date: new Date('2026-08-02'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: 'le-2', leaveLedgerEntry: { status: LedgerEntryStatus.PENDING, amount: -1000 }, deductionWaivedAt: null },
        { ...base, date: new Date('2026-08-03'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: new Date(), deductionWaivedReason: 'sick, approved' },
        { ...base, date: new Date('2026-08-04'), status: AttendanceStatus.HALF_DAY, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null },
        { ...base, date: new Date('2026-08-05'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: 'le-5', leaveLedgerEntry: { status: LedgerEntryStatus.VOIDED, amount: -1000 }, deductionWaivedAt: null },
        { ...base, date: new Date('2026-08-06'), status: AttendanceStatus.PRESENT, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: null },
      ]);
      const { attendance } = await svc.getBreakdown(adminUser, 'entry-001');
      expect(attendance.days.map((d) => d.decision)).toEqual(['DEDUCTED', 'DEDUCTED', 'WAIVED', 'PENDING', 'PENDING', null]);
      expect(attendance.days.map((d) => d.hasDeduction)).toEqual([true, true, false, false, false, false]);
      expect(attendance.days[2].waivedReason).toBe('sick, approved');
      expect(attendance.pendingDecisionDays).toBe(2);
      expect(attendance.decisionsApply).toBe(true);
    });

    it('has NO paid/unpaid decision for a DAILY/WEEKLY employee (absence is already unpaid by construction) - but still shows a live deduction', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.salaryStructure.findFirst.mockResolvedValue({ ...salaryStructure, payFrequency: PayFrequency.DAILY });
      const base = { note: null, category: null, deductionWaivedReason: null, deductionWaivedAt: null };
      prisma.staffAttendance.findMany.mockResolvedValue([
        { ...base, date: new Date('2026-08-01'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: null, leaveLedgerEntry: null },
        { ...base, date: new Date('2026-08-02'), status: AttendanceStatus.ABSENT, leaveLedgerEntryId: 'le-1', leaveLedgerEntry: { status: LedgerEntryStatus.POSTED, amount: -500 } },
      ]);
      const { attendance } = await svc.getBreakdown(adminUser, 'entry-001');
      expect(attendance.decisionsApply).toBe(false);
      expect(attendance.days.map((d) => d.decision)).toEqual([null, 'DEDUCTED']);
      expect(attendance.pendingDecisionDays).toBe(0);
    });

    it('returns suggestedMonthlyDailyRate = baseAmount / periodDayCount for a MONTHLY employee, rounded', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.salaryStructure.findFirst.mockResolvedValue({ ...salaryStructure, payFrequency: PayFrequency.MONTHLY, baseAmount: 31000 });
      const result = await svc.getBreakdown(adminUser, 'entry-001');
      // 31000 / 31 = 1000 exactly.
      expect(result.suggestedMonthlyDailyRate).toBe(1000);
    });

    it('returns suggestedMonthlyDailyRate = null for a non-MONTHLY employee', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.salaryStructure.findFirst.mockResolvedValue({ ...salaryStructure, payFrequency: PayFrequency.DAILY, baseAmount: 1000 });
      const result = await svc.getBreakdown(adminUser, 'entry-001');
      expect(result.suggestedMonthlyDailyRate).toBeNull();
    });

    it('delegates advancePlans to StaffAdvancePlanService.listForEmployeePeriod, scoped to this entry\'s vendor/employee/period', async () => {
      const stubPlans = [{ id: 'plan-1', remainingBalance: 40000, installment: null }];
      const { svc, advancePlans } = makeBreakdownService(true, {}, { listForEmployeePeriod: jest.fn().mockResolvedValue(stubPlans) });
      const result = await svc.getBreakdown(adminUser, 'entry-001');
      expect(result.advancePlans).toBe(stubPlans);
      expect(advancePlans.listForEmployeePeriod).toHaveBeenCalledWith(VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
    });

    // ── self-view-only scoping (payroll:view_all) ───────────────────────────

    it('allows a user to view their own entry\'s breakdown with no payroll:view_all permission', async () => {
      const { svc, permissions } = makeBreakdownService(false);
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;
      await expect(svc.getBreakdown(self, 'entry-001')).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('rejects viewing another employee\'s entry breakdown without payroll:view_all', async () => {
      const { svc } = makeBreakdownService(false);
      const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;
      await expect(svc.getBreakdown(otherStaffUser, 'entry-001')).rejects.toThrow(ForbiddenException);
    });

    it('allows viewing another employee\'s entry breakdown with payroll:view_all', async () => {
      const { svc } = makeBreakdownService(true);
      const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;
      await expect(svc.getBreakdown(otherStaffUser, 'entry-001')).resolves.toBeDefined();
    });
  });
});
