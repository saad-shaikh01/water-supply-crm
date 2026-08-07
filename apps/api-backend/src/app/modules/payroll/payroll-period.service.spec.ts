import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollAuditAction, PayrollEntryStatus, PayrollPeriodStatus } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const PERIOD_ID = 'period-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

const basePeriod = {
  id: PERIOD_ID,
  vendorId: VENDOR_ID,
  periodLabel: '2026-08',
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: new Date('2026-08-31T23:59:59.999Z'),
  status: PayrollPeriodStatus.REVIEW,
};

const emptyBuckets = {
  bonuses: 0,
  overtime: 0,
  incentives: 0,
  advances: 0,
  expenses: 0,
  penalties: 0,
  otherDeductions: 0,
};

function approvedEntry(id: string, userId: string) {
  return {
    id,
    periodId: PERIOD_ID,
    userId,
    status: PayrollEntryStatus.APPROVED,
    baseSalary: 30000,
    ...emptyBuckets,
    carryForwardIn: 0,
    finalPayable: 30000,
    user: { name: `Employee ${userId}` },
  };
}

/**
 * Default fresh-computation result returned by the mocked
 * `PayrollEntryService.computeEntryBreakdown` — matches whatever the entry
 * was already stored as, so most tests below don't care about the
 * recompute-vs-stored distinction. Tests specifically about that distinction
 * override this per-call.
 */
function defaultBreakdownFor(entry: ReturnType<typeof approvedEntry>) {
  return {
    buckets: { ...emptyBuckets },
    ledgerEntryIds: ['le-1', 'le-2'],
    carryForwardIn: entry.carryForwardIn,
    finalPayable: entry.finalPayable,
  };
}

function makeTx(overrides: any = {}) {
  return {
    payrollPeriod: {
      findFirst: jest.fn().mockResolvedValue(basePeriod),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ ...basePeriod, id: where.id, ...data })),
    },
    payrollEntry: {
      findMany: jest.fn().mockResolvedValue([approvedEntry('entry-1', 'emp-1')]),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    staffLedgerEntry: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    payrollSnapshot: {
      create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
    },
    payrollEntryAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ...overrides,
  };
}

function makeService(txOverrides: any = {}, computeEntryBreakdownImpl?: (...args: any[]) => any) {
  const tx = makeTx(txOverrides);
  const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
  const payrollEntries = {
    computeEntryBreakdown: jest.fn().mockImplementation(
      computeEntryBreakdownImpl ??
        (async (_tx: any, _vendorId: string, userId: string) => {
          const entries: any[] = await tx.payrollEntry.findMany({ where: {} });
          const entry = entries.find((e) => e.userId === userId) ?? entries[0];
          return defaultBreakdownFor(entry);
        }),
    ),
  };
  const svc = new PayrollPeriodService(prisma as any, payrollEntries as any);
  return { svc, prisma, tx, payrollEntries };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('PayrollPeriodService', () => {
  describe('lockPeriod()', () => {
    it('rejects locking when any entry is not yet APPROVED, listing the unresolved employee', async () => {
      const draftEntry = { ...approvedEntry('entry-2', 'emp-2'), status: PayrollEntryStatus.DRAFT };
      const { svc } = makeService({
        payrollEntry: {
          findMany: jest.fn().mockResolvedValue([approvedEntry('entry-1', 'emp-1'), draftEntry]),
          update: jest.fn(),
        },
      });

      await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(BadRequestException);
      await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(/emp-2|DRAFT/);
    });

    it('rejects locking a period with zero entries', async () => {
      const { svc } = makeService({ payrollEntry: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } });
      await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(BadRequestException);
    });

    it('rejects locking an already-LOCKED period', async () => {
      const { svc } = makeService({
        payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.LOCKED }), update: jest.fn() },
      });
      await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(BadRequestException);
    });

    it('scopes the entries lookup to this vendor', async () => {
      const { svc, tx } = makeService();
      await svc.lockPeriod(adminUser, PERIOD_ID);
      expect(tx.payrollEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ periodId: PERIOD_ID, vendorId: VENDOR_ID }) }),
      );
    });

    it('creates one PayrollSnapshot per entry, using the recomputed breakdown for both the snapshot and the ledger claim', async () => {
      const entries = [approvedEntry('entry-1', 'emp-1'), approvedEntry('entry-2', 'emp-2')];
      const { svc, tx, payrollEntries } = makeService({
        payrollEntry: { findMany: jest.fn().mockResolvedValue(entries), update: jest.fn().mockResolvedValue({}) },
      });

      const result = await svc.lockPeriod(adminUser, PERIOD_ID);

      expect(payrollEntries.computeEntryBreakdown).toHaveBeenCalledTimes(2);
      expect(payrollEntries.computeEntryBreakdown).toHaveBeenCalledWith(tx, VENDOR_ID, 'emp-1', basePeriod, 30000);

      expect(tx.payrollSnapshot.create).toHaveBeenCalledTimes(2);
      expect(tx.payrollSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payrollEntryId: 'entry-1',
            ledgerEntryIds: ['le-1', 'le-2'],
            breakdownJson: expect.objectContaining({ finalPayable: 30000 }),
          }),
        }),
      );

      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['le-1', 'le-2'] }, vendorId: VENDOR_ID },
        data: { payrollEntryId: 'entry-1' },
      });

      expect(tx.payrollEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1', vendorId: VENDOR_ID },
        data: { ...emptyBuckets, carryForwardIn: 0, finalPayable: 30000, status: PayrollEntryStatus.LOCKED },
      });

      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: PayrollAuditAction.LOCKED, payrollEntryId: 'entry-1' }) }),
      );

      expect(tx.payrollPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PERIOD_ID },
          data: expect.objectContaining({ status: PayrollPeriodStatus.LOCKED, lockedById: adminUser.userId }),
        }),
      );

      expect(result.lockedEntryCount).toBe(2);
    });

    it('throws NotFoundException when the period does not belong to this vendor', async () => {
      const { svc } = makeService({ payrollPeriod: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
      await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(NotFoundException);
    });

    // ── the regression this dispatch was fixing: fresh recompute at lock time ──

    it('reflects a ledger change made AFTER approval (a new POSTED bonus, or an existing entry voided) — not the stale at-approval numbers', async () => {
      const staleApprovedEntry = approvedEntry('entry-1', 'emp-1'); // finalPayable: 30000, stored at approval time
      // Simulates: after approval, a new BONUS of 500 got POSTED (ledger id
      // le-3) and the previously-counted le-2 got VOIDED before lock — so
      // the fresh set is ['le-1', 'le-3'], not the stale ['le-1', 'le-2'].
      const freshBreakdown = {
        buckets: { ...emptyBuckets, bonuses: 500 },
        ledgerEntryIds: ['le-1', 'le-3'],
        carryForwardIn: 0,
        finalPayable: 30500,
      };

      const { svc, tx } = makeService(
        { payrollEntry: { findMany: jest.fn().mockResolvedValue([staleApprovedEntry]), update: jest.fn().mockResolvedValue({}) } },
        async () => freshBreakdown,
      );

      await svc.lockPeriod(adminUser, PERIOD_ID);

      // Snapshot reflects the FRESH numbers, plus the stale approved value
      // recorded alongside for transparency since they differ.
      expect(tx.payrollSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ledgerEntryIds: ['le-1', 'le-3'],
            breakdownJson: expect.objectContaining({
              finalPayable: 30500,
              bonuses: 500,
              approvedFinalPayable: 30000,
            }),
          }),
        }),
      );

      // The claim (payrollEntryId set) targets the FRESH id set, not the
      // stale one — a newly-posted entry must be claimed, and a voided one
      // must never be claimed even though it was counted at approval time.
      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['le-1', 'le-3'] }, vendorId: VENDOR_ID },
        data: { payrollEntryId: 'entry-1' },
      });

      // The PayrollEntry's own stored columns are overwritten with the
      // fresh numbers too, not left at their stale generate-time values.
      expect(tx.payrollEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1', vendorId: VENDOR_ID },
        data: { ...emptyBuckets, bonuses: 500, carryForwardIn: 0, finalPayable: 30500, status: PayrollEntryStatus.LOCKED },
      });
    });

    it('does not record approvedFinalPayable when the fresh recompute matches what was stored at approval', async () => {
      const { svc, tx } = makeService();
      await svc.lockPeriod(adminUser, PERIOD_ID);

      const snapshotCall = tx.payrollSnapshot.create.mock.calls[0][0];
      expect(snapshotCall.data.breakdownJson).not.toHaveProperty('approvedFinalPayable');
    });
  });

  describe('unlockPeriod()', () => {
    it('requires a non-empty reason', async () => {
      const { svc, prisma } = makeService({
        payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.LOCKED }), update: jest.fn() },
      });
      await expect(svc.unlockPeriod(adminUser, PERIOD_ID, '')).rejects.toThrow(BadRequestException);
      await expect(svc.unlockPeriod(adminUser, PERIOD_ID, '   ')).rejects.toThrow(BadRequestException);
      // Never even opens a transaction without a reason.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects unlocking a period that is not LOCKED', async () => {
      const { svc } = makeService({
        payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.REVIEW }), update: jest.fn() },
      });
      await expect(svc.unlockPeriod(adminUser, PERIOD_ID, 'mistake')).rejects.toThrow(BadRequestException);
    });

    it('clears payrollEntryId on every ledger entry, resets entries to APPROVED (not DRAFT), and writes UNLOCKED audit rows with the reason', async () => {
      const lockedEntry = { ...approvedEntry('entry-1', 'emp-1'), status: PayrollEntryStatus.LOCKED };
      const { svc, tx } = makeService({
        payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.LOCKED }), update: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.REVIEW }) },
        payrollEntry: { findMany: jest.fn().mockResolvedValue([lockedEntry]), update: jest.fn().mockResolvedValue({}) },
      });

      const result = await svc.unlockPeriod(adminUser, PERIOD_ID, 'found a data entry mistake');

      expect(tx.payrollEntry.findMany).toHaveBeenCalledWith({ where: { periodId: PERIOD_ID, vendorId: VENDOR_ID } });

      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith({
        where: { payrollEntryId: 'entry-1', vendorId: VENDOR_ID },
        data: { payrollEntryId: null },
      });
      expect(tx.payrollEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1', vendorId: VENDOR_ID },
        data: { status: PayrollEntryStatus.APPROVED },
      });
      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: PayrollAuditAction.UNLOCKED,
            reason: 'found a data entry mistake',
          }),
        }),
      );
      expect(tx.payrollPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: PERIOD_ID }, data: { status: PayrollPeriodStatus.REVIEW } }),
      );
      expect(result.unlockedEntryCount).toBe(1);
    });

    it('does not touch PayrollSnapshot rows', async () => {
      const lockedEntry = { ...approvedEntry('entry-1', 'emp-1'), status: PayrollEntryStatus.LOCKED };
      const { svc, tx } = makeService({
        payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ ...basePeriod, status: PayrollPeriodStatus.LOCKED }), update: jest.fn().mockResolvedValue({}) },
        payrollEntry: { findMany: jest.fn().mockResolvedValue([lockedEntry]), update: jest.fn().mockResolvedValue({}) },
      });
      await svc.unlockPeriod(adminUser, PERIOD_ID, 'reason');
      expect(tx.payrollSnapshot.create).not.toHaveBeenCalled();
    });
  });

  describe('listPeriods()', () => {
    it('lists periods for the caller\'s vendor only, newest first', async () => {
      const periods = [
        { ...basePeriod, id: 'period-002', periodLabel: '2026-09' },
        basePeriod,
      ];
      const findMany = jest.fn().mockResolvedValue(periods);
      const prisma = { payrollPeriod: { findMany } };
      const svc = new PayrollPeriodService(prisma as any, {} as any);

      const result = await svc.listPeriods(adminUser);

      expect(findMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID },
        orderBy: { startDate: 'desc' },
      });
      expect(result).toEqual(periods);
    });
  });

  describe('getOrCreateOpenPeriod()', () => {
    it('returns the existing OPEN period without creating a new one', async () => {
      const prisma = {
        payrollPeriod: {
          findFirst: jest.fn().mockResolvedValue(basePeriod),
          findUnique: jest.fn(),
          create: jest.fn(),
        },
        payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const svc = new PayrollPeriodService(prisma as any, {} as any);
      const result = await svc.getOrCreateOpenPeriod(adminUser);

      expect(result).toBe(basePeriod);
      expect(prisma.payrollPeriod.create).not.toHaveBeenCalled();
    });

    it('creates a new period for the current cycle when none is OPEN, using cutoffDay=1 default', async () => {
      const prisma = {
        payrollPeriod: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-period', ...data })),
        },
        payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const svc = new PayrollPeriodService(prisma as any, {} as any);
      const result = await svc.getOrCreateOpenPeriod(adminUser);

      expect(prisma.payrollPeriod.create).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PayrollPeriodStatus.OPEN);
      expect(result.vendorId).toBe(VENDOR_ID);
    });

    it('is idempotent — returns the existing period by label instead of creating a duplicate', async () => {
      const existingByLabel = { ...basePeriod, status: PayrollPeriodStatus.REVIEW };
      const prisma = {
        payrollPeriod: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(existingByLabel),
          create: jest.fn(),
        },
        payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const svc = new PayrollPeriodService(prisma as any, {} as any);
      const result = await svc.getOrCreateOpenPeriod(adminUser);

      expect(result).toBe(existingByLabel);
      expect(prisma.payrollPeriod.create).not.toHaveBeenCalled();
    });
  });
});
