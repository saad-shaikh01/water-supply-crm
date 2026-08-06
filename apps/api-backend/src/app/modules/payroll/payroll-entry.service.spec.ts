import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayrollEntryService } from './payroll-entry.service';
import { LedgerEntryStatus, PayrollAuditAction, PayrollEntryStatus, PayrollPeriodStatus, StaffLedgerCategory } from '@prisma/client';

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
