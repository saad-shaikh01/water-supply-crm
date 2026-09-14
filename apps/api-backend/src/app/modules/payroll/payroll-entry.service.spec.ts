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
    ...overrides,
  };
}

function makeService(opts: { period?: any; eligibleEmployees?: any[]; txOverrides?: any } = {}) {
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

  const svc = new PayrollEntryService(prisma as any, permissions as any);
  return { svc, prisma, tx, permissions };
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
      const draftEntry = { id: 'entry-001', vendorId: VENDOR_ID, status: PayrollEntryStatus.DRAFT, version: 0 };
      tx.payrollEntry.findFirst.mockResolvedValue(draftEntry);
      tx.payrollEntry.updateMany.mockResolvedValue({ count: 1 });
      tx.payrollEntry.findUniqueOrThrow.mockResolvedValue({ ...draftEntry, status: PayrollEntryStatus.APPROVED, version: 1 });

      const result = await svc.approveEntry(adminUser, 'entry-001', 0);
      expect(result.status).toBe(PayrollEntryStatus.APPROVED);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc, tx } = makeService();
      const draftEntry = { id: 'entry-001', vendorId: VENDOR_ID, status: PayrollEntryStatus.DRAFT, version: 0 };
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

  describe('getBreakdown()', () => {
    function makeBreakdownService(canViewAll = true, entryOverrides: any = {}) {
      const prisma = {
        payrollEntry: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'entry-001',
            vendorId: VENDOR_ID,
            userId: EMPLOYEE_ID,
            period: openPeriod,
            ...entryOverrides,
          }),
        },
        staffLedgerEntry: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'le-1', category: StaffLedgerCategory.BONUS, amount: 1000, effectiveDate: new Date() },
            { id: 'le-2', category: StaffLedgerCategory.ADVANCE, amount: -500, effectiveDate: new Date() },
          ]),
        },
      };
      const permissions = { can: jest.fn().mockResolvedValue(canViewAll) };
      const svc = new PayrollEntryService(prisma as any, permissions as any);
      return { svc, prisma, permissions };
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
            effectiveDate: { gte: openPeriod.startDate, lte: openPeriod.endDate },
          }),
        }),
      );
    });

    it('throws NotFoundException when the entry does not belong to this vendor', async () => {
      const { svc, prisma } = makeBreakdownService();
      prisma.payrollEntry.findFirst.mockResolvedValue(null);
      await expect(svc.getBreakdown(adminUser, 'entry-001')).rejects.toThrow(NotFoundException);
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
