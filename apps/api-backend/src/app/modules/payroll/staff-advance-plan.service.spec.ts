import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StaffAdvancePlanService } from './staff-advance-plan.service';
import { AdvanceInstallmentStatus, AdvancePlanStatus, PayrollPeriodStatus, StaffLedgerCategory } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const EMPLOYEE_ID = 'employee-001';
const PLAN_ID = 'plan-001';
const PERIOD_ID = 'period-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin One' } as any;

const employee = { id: EMPLOYEE_ID, role: 'DRIVER', isActive: true };

const openPeriod = { id: PERIOD_ID, vendorId: VENDOR_ID, periodLabel: '2026-08', status: PayrollPeriodStatus.OPEN };

function makePlan(overrides: any = {}) {
  return {
    id: PLAN_ID,
    vendorId: VENDOR_ID,
    userId: EMPLOYEE_ID,
    principalAmount: 50000,
    defaultInstallmentAmount: 10000,
    status: AdvancePlanStatus.ACTIVE,
    ...overrides,
  };
}

function makeStaffLedgerMock() {
  return {
    createTx: jest.fn().mockImplementation(async (_tx: any, _user: any, dto: any) => ({ id: 'fresh-ledger-1', ...dto })),
  };
}

function makeService(opts: { txOverrides?: any; prismaOverrides?: any } = {}) {
  const tx = {
    staffAdvancePlan: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: PLAN_ID, ...data })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(makePlan()),
    },
    staffAdvanceInstallment: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'inst-new', ...data })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: null } }),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
    ...opts.txOverrides,
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: { findFirst: jest.fn().mockResolvedValue(employee) },
    staffAdvancePlan: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    staffAdvanceInstallment: { count: jest.fn().mockResolvedValue(0) },
    ...opts.prismaOverrides,
  };
  const staffLedger = makeStaffLedgerMock();
  const permissions = { can: jest.fn().mockResolvedValue(true) };
  const svc = new StaffAdvancePlanService(prisma as any, staffLedger as any, permissions as any);
  return { svc, prisma, tx, staffLedger, permissions };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('StaffAdvancePlanService', () => {
  describe('create()', () => {
    it('posts the full principal as one ADVANCE_DISBURSEMENT entry, then creates the plan linked to it', async () => {
      const { svc, tx, staffLedger } = makeService();
      await svc.create(adminUser, {
        userId: EMPLOYEE_ID,
        principalAmount: 50000,
        defaultInstallmentAmount: 10000,
        disbursedAt: '2026-08-05',
        note: 'Emergency advance',
      });

      expect(staffLedger.createTx).toHaveBeenCalledWith(
        tx,
        adminUser,
        expect.objectContaining({
          userId: EMPLOYEE_ID,
          category: StaffLedgerCategory.ADVANCE_DISBURSEMENT,
          amount: -50000,
          effectiveDate: '2026-08-05',
        }),
      );
      expect(tx.staffAdvancePlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            principalAmount: 50000,
            defaultInstallmentAmount: 10000,
            disbursementLedgerEntryId: 'fresh-ledger-1',
          }),
        }),
      );
    });

    it('rejects a non-payroll-eligible employee', async () => {
      const { svc, prisma } = makeService({ prismaOverrides: { user: { findFirst: jest.fn().mockResolvedValue({ ...employee, role: 'VENDOR_ADMIN' }) } } });
      await expect(
        svc.create(adminUser, { userId: EMPLOYEE_ID, principalAmount: 5000, defaultInstallmentAmount: 1000, disbursedAt: '2026-08-05' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown employee', async () => {
      const { svc } = makeService({ prismaOverrides: { user: { findFirst: jest.fn().mockResolvedValue(null) } } });
      await expect(
        svc.create(adminUser, { userId: 'nope', principalAmount: 5000, defaultInstallmentAmount: 1000, disbursedAt: '2026-08-05' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('collect()', () => {
    function installmentFixture(overrides: any = {}) {
      return {
        id: 'inst-1',
        vendorId: VENDOR_ID,
        planId: PLAN_ID,
        periodId: PERIOD_ID,
        scheduledAmount: 10000,
        status: AdvanceInstallmentStatus.PENDING,
        plan: makePlan(),
        period: openPeriod,
        ...overrides,
      };
    }

    it('collects the scheduled amount by default, posts one ADVANCE_RECOVERY entry, marks COLLECTED', async () => {
      const { svc, tx, staffLedger } = makeService({
        txOverrides: { staffAdvanceInstallment: { findFirst: jest.fn().mockResolvedValue(installmentFixture()), update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })), aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: null } }) } },
      });
      const result = await svc.collect(adminUser, 'inst-1', {});

      expect(staffLedger.createTx).toHaveBeenCalledWith(
        tx,
        adminUser,
        expect.objectContaining({ category: StaffLedgerCategory.ADVANCE_RECOVERY, amount: -10000, userId: EMPLOYEE_ID }),
      );
      expect(result.status).toBe(AdvanceInstallmentStatus.COLLECTED);
      expect(result.actualAmount).toBe(10000);
    });

    it('allows an override amount, up or down, as long as it does not exceed the remaining balance', async () => {
      const { svc, staffLedger } = makeService({
        txOverrides: {
          staffAdvanceInstallment: {
            findFirst: jest.fn().mockResolvedValue(installmentFixture()),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: null } }), // remaining = 50000
          },
        },
      });
      await svc.collect(adminUser, 'inst-1', { amount: 15000 });
      expect(staffLedger.createTx).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ amount: -15000 }));
    });

    it('rejects an amount exceeding the remaining balance', async () => {
      const { svc } = makeService({
        txOverrides: {
          staffAdvanceInstallment: {
            findFirst: jest.fn().mockResolvedValue(installmentFixture()),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 45000 } }), // remaining = 5000
          },
        },
      });
      await expect(svc.collect(adminUser, 'inst-1', { amount: 6000 })).rejects.toThrow(BadRequestException);
    });

    it('completes the plan when this collection brings the remaining balance to exactly 0', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvanceInstallment: {
            findFirst: jest.fn().mockResolvedValue(installmentFixture({ scheduledAmount: 5000 })),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 45000 } }), // remaining = 5000
          },
        },
      });
      await svc.collect(adminUser, 'inst-1', {});
      expect(tx.staffAdvancePlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: PLAN_ID }, data: { status: AdvancePlanStatus.COMPLETED } }),
      );
    });

    it('rejects collecting an installment that is not PENDING', async () => {
      const { svc } = makeService({
        txOverrides: { staffAdvanceInstallment: { findFirst: jest.fn().mockResolvedValue(installmentFixture({ status: AdvanceInstallmentStatus.SKIPPED })) } },
      });
      await expect(svc.collect(adminUser, 'inst-1', {})).rejects.toThrow(BadRequestException);
    });

    it('rejects acting on an installment whose period is already LOCKED', async () => {
      const { svc } = makeService({
        txOverrides: {
          staffAdvanceInstallment: { findFirst: jest.fn().mockResolvedValue(installmentFixture({ period: { ...openPeriod, status: PayrollPeriodStatus.LOCKED } })) },
        },
      });
      await expect(svc.collect(adminUser, 'inst-1', {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an installment outside this vendor', async () => {
      const { svc } = makeService({ txOverrides: { staffAdvanceInstallment: { findFirst: jest.fn().mockResolvedValue(null) } } });
      await expect(svc.collect(adminUser, 'inst-1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('skip()', () => {
    it('marks SKIPPED with no ledger entry, leaving the balance untouched', async () => {
      const { svc, tx, staffLedger } = makeService({
        txOverrides: {
          staffAdvanceInstallment: {
            findFirst: jest.fn().mockResolvedValue({ id: 'inst-1', vendorId: VENDOR_ID, status: AdvanceInstallmentStatus.PENDING, period: openPeriod }),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
          },
        },
      });
      const result = await svc.skip(adminUser, 'inst-1');
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(result.status).toBe(AdvanceInstallmentStatus.SKIPPED);
      expect(result.actualAmount).toBe(0);
    });

    it('rejects skipping a non-PENDING installment', async () => {
      const { svc } = makeService({
        txOverrides: {
          staffAdvanceInstallment: { findFirst: jest.fn().mockResolvedValue({ id: 'inst-1', vendorId: VENDOR_ID, status: AdvanceInstallmentStatus.COLLECTED, period: openPeriod }) },
        },
      });
      await expect(svc.skip(adminUser, 'inst-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('ensureInstallmentsForPeriod() — the skip → roll-forward mechanism', () => {
    it('creates one PENDING installment for an ACTIVE plan with no row yet this period, sized to min(default, remaining)', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: { findMany: jest.fn().mockResolvedValue([makePlan()]) },
          staffAdvanceInstallment: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'inst-new', ...data })),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: null } }), // remaining = 50000
          },
        },
      });
      await svc.ensureInstallmentsForPeriod(tx as any, VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
      expect(tx.staffAdvanceInstallment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planId: PLAN_ID, periodId: PERIOD_ID, scheduledAmount: 10000, status: AdvanceInstallmentStatus.PENDING }) }),
      );
    });

    it('caps scheduledAmount to the remaining balance when it is smaller than the default installment', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: { findMany: jest.fn().mockResolvedValue([makePlan()]) },
          staffAdvanceInstallment: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'inst-new', ...data })),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 47000 } }), // remaining = 3000 < default 10000
          },
        },
      });
      await svc.ensureInstallmentsForPeriod(tx as any, VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
      expect(tx.staffAdvanceInstallment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ scheduledAmount: 3000 }) }),
      );
    });

    it('is a no-op (idempotent) when a row already exists for this plan+period — regeneration never double-creates', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: { findMany: jest.fn().mockResolvedValue([makePlan()]) },
          staffAdvanceInstallment: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn() },
        },
      });
      await svc.ensureInstallmentsForPeriod(tx as any, VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
      expect(tx.staffAdvanceInstallment.create).not.toHaveBeenCalled();
    });

    it('does not generate an installment for a plan with 0 remaining balance', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: { findMany: jest.fn().mockResolvedValue([makePlan()]) },
          staffAdvanceInstallment: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 50000 } }), // remaining = 0
          },
        },
      });
      await svc.ensureInstallmentsForPeriod(tx as any, VENDOR_ID, EMPLOYEE_ID, PERIOD_ID);
      expect(tx.staffAdvanceInstallment.create).not.toHaveBeenCalled();
    });
  });

  describe('autoSkipPendingForPeriod()', () => {
    it('bulk-flips every PENDING installment for this vendor/period to SKIPPED', async () => {
      const { svc, tx } = makeService();
      await svc.autoSkipPendingForPeriod(tx as any, VENDOR_ID, PERIOD_ID, adminUser.userId);
      expect(tx.staffAdvanceInstallment.updateMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, periodId: PERIOD_ID, status: AdvanceInstallmentStatus.PENDING },
        data: { status: AdvanceInstallmentStatus.SKIPPED, actualAmount: 0, decidedById: adminUser.userId, decidedAt: expect.any(Date) },
      });
    });
  });

  describe('writeOff()', () => {
    const writeOffDto = { reason: 'Employee resigned — remaining balance is unrecoverable.' };

    it('cancels the plan, auto-skips its PENDING installments, and writes an audit log — no ledger entry posted', async () => {
      const { svc, tx, staffLedger } = makeService({
        txOverrides: {
          staffAdvancePlan: {
            findFirst: jest.fn().mockResolvedValue(makePlan()),
            update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
          },
          staffAdvanceInstallment: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 10000 } }) }, // remaining = 40000
        },
      });

      const result = await svc.writeOff(adminUser, PLAN_ID, writeOffDto as any);

      expect(tx.staffAdvanceInstallment.updateMany).toHaveBeenCalledWith({
        where: { planId: PLAN_ID, status: AdvanceInstallmentStatus.PENDING },
        data: { status: AdvanceInstallmentStatus.SKIPPED, actualAmount: 0, decidedById: adminUser.userId, decidedAt: expect.any(Date) },
      });
      expect(tx.staffAdvancePlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PLAN_ID },
          data: expect.objectContaining({ status: AdvancePlanStatus.CANCELLED, cancelReason: writeOffDto.reason }),
        }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entity: 'StaffAdvancePlan', entityId: PLAN_ID, action: 'WRITE_OFF' }) }),
      );
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(result.status).toBe(AdvancePlanStatus.CANCELLED);
    });

    it('rejects writing off a non-ACTIVE plan', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: {
            findFirst: jest.fn().mockResolvedValue(makePlan({ status: AdvancePlanStatus.COMPLETED })),
            update: jest.fn(),
          },
        },
      });
      await expect(svc.writeOff(adminUser, PLAN_ID, writeOffDto as any)).rejects.toThrow(BadRequestException);
      expect(tx.staffAdvancePlan.update).not.toHaveBeenCalled();
    });

    it('rejects writing off a plan with no remaining balance', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          staffAdvancePlan: { findFirst: jest.fn().mockResolvedValue(makePlan()), update: jest.fn() },
          staffAdvanceInstallment: { aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: 50000 } }) }, // remaining = 0
        },
      });
      await expect(svc.writeOff(adminUser, PLAN_ID, writeOffDto as any)).rejects.toThrow(BadRequestException);
      expect(tx.staffAdvancePlan.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a plan outside this vendor', async () => {
      const { svc } = makeService({ txOverrides: { staffAdvancePlan: { findFirst: jest.fn().mockResolvedValue(null) } } });
      await expect(svc.writeOff(adminUser, 'nope', writeOffDto as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getVendorSummary()', () => {
    it('sums remaining balance across every ACTIVE plan for the vendor', async () => {
      const { svc, prisma } = makeService({
        prismaOverrides: {
          staffAdvancePlan: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'plan-a', principalAmount: 50000 },
              { id: 'plan-b', principalAmount: 20000 },
            ]),
          },
          staffAdvanceInstallment: {
            count: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockImplementation(async ({ where }: any) =>
              where.planId === 'plan-a' ? { _sum: { actualAmount: 10000 } } : { _sum: { actualAmount: null } },
            ),
          },
        },
      });

      const result = await svc.getVendorSummary(adminUser);

      expect(prisma.staffAdvancePlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: VENDOR_ID, status: AdvancePlanStatus.ACTIVE } }),
      );
      // plan-a: 50000 - 10000 = 40000; plan-b: 20000 - 0 = 20000; total = 60000.
      expect(result).toEqual({ activePlanCount: 2, totalRemainingBalance: 60000 });
    });

    it('returns zero for a vendor with no active plans', async () => {
      const { svc } = makeService({
        prismaOverrides: { staffAdvancePlan: { findMany: jest.fn().mockResolvedValue([]) } },
      });
      const result = await svc.getVendorSummary(adminUser);
      expect(result).toEqual({ activePlanCount: 0, totalRemainingBalance: 0 });
    });
  });

  describe('countPendingForPeriod()', () => {
    it('counts PENDING installments scoped to this vendor and period', async () => {
      const { svc, prisma } = makeService({
        prismaOverrides: { staffAdvanceInstallment: { count: jest.fn().mockResolvedValue(3) } },
      });
      const result = await svc.countPendingForPeriod(adminUser, PERIOD_ID);
      expect(result).toBe(3);
      expect(prisma.staffAdvanceInstallment.count).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, periodId: PERIOD_ID, status: AdvanceInstallmentStatus.PENDING },
      });
    });
  });
});
