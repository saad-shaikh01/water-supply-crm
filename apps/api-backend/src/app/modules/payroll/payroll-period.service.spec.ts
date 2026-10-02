import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollAuditAction, PayrollEntryStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';

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
      // by-id lookup → this period; the "earlier OPEN/REVIEW period" ordering-guard query (no id) → none
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => (where?.id ? basePeriod : null)),
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
  const advancePlans = { autoSkipPendingForPeriod: jest.fn().mockResolvedValue(undefined) };
  const svc = new PayrollPeriodService(prisma as any, payrollEntries as any, advancePlans as any);
  return { svc, prisma, tx, payrollEntries, advancePlans };
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

    it('auto-skips any still-PENDING advance installment for this period as part of locking it', async () => {
      const { svc, advancePlans } = makeService();
      await svc.lockPeriod(adminUser, PERIOD_ID);
      expect(advancePlans.autoSkipPendingForPeriod).toHaveBeenCalledWith(expect.anything(), VENDOR_ID, PERIOD_ID, adminUser.userId);
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

    describe('ordering guard — an earlier OPEN/REVIEW period must be locked first', () => {
      const octPeriod = {
        ...basePeriod,
        periodLabel: '2026-10',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T23:59:59.999Z'),
        status: PayrollPeriodStatus.OPEN,
      };
      const earlierLookup = (earlier: any) =>
        jest.fn().mockImplementation(async ({ where }: any) => (where?.id ? octPeriod : earlier));

      it('rejects locking October while September is still active, naming September', async () => {
        const { svc, tx } = makeService({
          payrollPeriod: { findFirst: earlierLookup({ periodLabel: '2026-09' }), update: jest.fn() },
        });
        await expect(svc.lockPeriod(adminUser, PERIOD_ID)).rejects.toThrow(/2026-09/);
        expect(tx.payrollPeriod.update).not.toHaveBeenCalled();
      });

      it('queries only earlier OPEN/REVIEW periods that actually have entries, for this vendor', async () => {
        const findFirst = earlierLookup(null);
        const { svc } = makeService({ payrollPeriod: { findFirst, update: jest.fn().mockResolvedValue({}) } });
        await svc.lockPeriod(adminUser, PERIOD_ID);

        expect(findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              vendorId: VENDOR_ID,
              endDate: { lt: octPeriod.startDate },
              status: { in: [PayrollPeriodStatus.OPEN, PayrollPeriodStatus.REVIEW] },
              entries: { some: {} },
            },
          }),
        );
      });

      it('allows locking when no earlier period is active', async () => {
        const { svc } = makeService({ payrollPeriod: { findFirst: earlierLookup(null), update: jest.fn().mockResolvedValue({}) } });
        await expect(svc.lockPeriod(adminUser, PERIOD_ID)).resolves.toEqual(expect.objectContaining({ lockedEntryCount: 1 }));
      });
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
      const svc = new PayrollPeriodService(prisma as any, {} as any, {} as any);

      const result = await svc.listPeriods(adminUser);

      expect(findMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID },
        orderBy: { startDate: 'desc' },
      });
      expect(result).toEqual(periods);
    });
  });

  // In-memory PayrollPeriod store: findFirst understands the two query shapes the service issues —
  // the settlement pointer (status in [...], startDate asc) and the covering-range lookup.
  function makePeriodStore(rows: any[], opts: { createError?: any } = {}) {
    const findFirst = jest.fn().mockImplementation(async ({ where, orderBy }: any) => {
      let hits = rows.filter((r) => r.vendorId === where.vendorId);
      if (where.status?.in) hits = hits.filter((r) => where.status.in.includes(r.status));
      if (where.startDate?.lte) hits = hits.filter((r) => r.startDate <= where.startDate.lte);
      if (where.endDate?.gte) hits = hits.filter((r) => r.endDate >= where.endDate.gte);
      if (orderBy?.startDate) hits = [...hits].sort((a, b) => (a.startDate < b.startDate ? -1 : 1) * (orderBy.startDate === 'asc' ? 1 : -1));
      return hits[0] ?? null;
    });
    const create = jest.fn().mockImplementation(async ({ data }: any) => {
      if (opts.createError) throw opts.createError;
      const row = { id: `new-${data.periodLabel}`, ...data };
      rows.push(row);
      return row;
    });
    const prisma = { payrollPeriod: { findFirst, create }, payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(null) } };
    return { prisma, findFirst, create, svc: new PayrollPeriodService(prisma as any, {} as any, {} as any) };
  }

  const period = (label: string, status: PayrollPeriodStatus, startIso: string, endIso: string) => ({
    id: `p-${label}`,
    vendorId: VENDOR_ID,
    periodLabel: label,
    startDate: new Date(startIso),
    endDate: new Date(endIso),
    status,
  });
  const SEP = (status: PayrollPeriodStatus) => period('2026-09', status, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z');
  const OCT = (status: PayrollPeriodStatus) => period('2026-10', status, '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z');
  const NOV = (status: PayrollPeriodStatus) => period('2026-11', status, '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z');

  describe('getOrCreateOpenPeriod() — settlement pointer (oldest OPEN/REVIEW)', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-02T06:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('returns the existing OPEN period without creating a new one', async () => {
      const sep = SEP(PayrollPeriodStatus.OPEN);
      const { svc, create } = makePeriodStore([sep]);
      expect(await svc.getOrCreateOpenPeriod(adminUser)).toBe(sep);
      expect(create).not.toHaveBeenCalled();
    });

    it('Sep, Oct, Nov all OPEN → September', async () => {
      const sep = SEP(PayrollPeriodStatus.OPEN);
      const { svc } = makePeriodStore([NOV(PayrollPeriodStatus.OPEN), OCT(PayrollPeriodStatus.OPEN), sep]);
      expect(await svc.getOrCreateOpenPeriod(adminUser)).toBe(sep);
    });

    it('Scenario A: Sep REVIEW + Oct OPEN → September', async () => {
      const sep = SEP(PayrollPeriodStatus.REVIEW);
      const { svc } = makePeriodStore([OCT(PayrollPeriodStatus.OPEN), sep]);
      expect(await svc.getOrCreateOpenPeriod(adminUser)).toBe(sep);
    });

    it('Scenario B: Sep LOCKED (payments pending) + Oct OPEN → October', async () => {
      const oct = OCT(PayrollPeriodStatus.OPEN);
      const { svc } = makePeriodStore([SEP(PayrollPeriodStatus.LOCKED), oct]);
      expect(await svc.getOrCreateOpenPeriod(adminUser)).toBe(oct);
    });

    it('Scenario C: Sep unlocked back to REVIEW + Oct OPEN → September again', async () => {
      const sep = SEP(PayrollPeriodStatus.REVIEW);
      const { svc } = makePeriodStore([OCT(PayrollPeriodStatus.OPEN), sep]);
      expect((await svc.getOrCreateOpenPeriod(adminUser)).periodLabel).toBe('2026-09');
    });

    it('creates the current-cycle period (cutoffDay=1 default) when nothing is OPEN/REVIEW', async () => {
      const { svc, create } = makePeriodStore([SEP(PayrollPeriodStatus.LOCKED)]);
      const result = await svc.getOrCreateOpenPeriod(adminUser);

      expect(create).toHaveBeenCalledTimes(1);
      expect(result.periodLabel).toBe('2026-10');
      expect(result.status).toBe(PayrollPeriodStatus.OPEN);
      expect(result.vendorId).toBe(VENDOR_ID);
    });

    it('is idempotent — falls back to the existing period covering today (any status) instead of duplicating it', async () => {
      const lockedOct = OCT(PayrollPeriodStatus.LOCKED);
      const { svc, create } = makePeriodStore([lockedOct]);
      expect(await svc.getOrCreateOpenPeriod(adminUser)).toBe(lockedOct);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentAttendancePeriod() — calendar period, independent of payroll status', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-02T06:00:00.000Z') }));
    afterEach(() => jest.useRealTimers());

    it('on 2 Oct with September still OPEN, resolves (and creates) October — not September', async () => {
      const { svc, create } = makePeriodStore([SEP(PayrollPeriodStatus.OPEN)]);
      const result = await svc.getCurrentAttendancePeriod(adminUser);

      expect(result.periodLabel).toBe('2026-10');
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ vendorId: VENDOR_ID, periodLabel: '2026-10', status: PayrollPeriodStatus.OPEN }),
      });
    });

    it('never creates a past or future period (no September/November row is created)', async () => {
      const { svc, create } = makePeriodStore([]);
      await svc.getCurrentAttendancePeriod(adminUser);
      const labels = create.mock.calls.map(([arg]: any) => arg.data.periodLabel);
      expect(labels).toEqual(['2026-10']);
    });

    it('is idempotent — a second call returns the same row without creating another', async () => {
      const { svc, create } = makePeriodStore([SEP(PayrollPeriodStatus.OPEN)]);
      const first = await svc.getCurrentAttendancePeriod(adminUser);
      const second = await svc.getCurrentAttendancePeriod(adminUser);
      expect(second).toBe(first);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('does not change the settlement pointer — September stays the oldest OPEN period', async () => {
      const { svc } = makePeriodStore([SEP(PayrollPeriodStatus.OPEN)]);
      await svc.getCurrentAttendancePeriod(adminUser); // creates October (OPEN)
      expect((await svc.getOrCreateOpenPeriod(adminUser)).periodLabel).toBe('2026-09');
    });

    it('returns the LOCKED period for today as-is (attendance ignores payroll status)', async () => {
      const lockedOct = OCT(PayrollPeriodStatus.LOCKED);
      const { svc, create } = makePeriodStore([lockedOct]);
      expect(await svc.getCurrentAttendancePeriod(adminUser)).toBe(lockedOct);
      expect(create).not.toHaveBeenCalled();
    });

    it('is scoped to the caller\'s vendor', async () => {
      const { svc, findFirst } = makePeriodStore([]);
      await svc.getCurrentAttendancePeriod(adminUser);
      expect(findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ vendorId: VENDOR_ID }),
      });
    });
  });

  describe('ensurePeriodForDate()', () => {
    it('creates the October period on 1 Oct 01:00 PKT even though UTC is still 30 Sep', async () => {
      const { svc, create } = makePeriodStore([SEP(PayrollPeriodStatus.OPEN)]);
      const result = await svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-09-30T20:00:00.000Z'));

      expect(create).toHaveBeenCalledTimes(1);
      expect(result.periodLabel).toBe('2026-10');
      expect(result.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2026-10-31T23:59:59.999Z');
    });

    it('still resolves September at 30 Sep 23:00 PKT (UTC 18:00)', async () => {
      const sep = SEP(PayrollPeriodStatus.OPEN);
      const { svc, create } = makePeriodStore([sep]);
      expect(await svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-09-30T18:00:00.000Z'))).toBe(sep);
      expect(create).not.toHaveBeenCalled();
    });

    it('returns a LOCKED period covering the date as-is — never recreates or reopens it', async () => {
      const lockedSep = SEP(PayrollPeriodStatus.LOCKED);
      const { svc, create } = makePeriodStore([lockedSep]);
      expect(await svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-09-15T06:00:00.000Z'))).toBe(lockedSep);
      expect(create).not.toHaveBeenCalled();
    });

    it('honours a configured cutoffDay (cycle 10 Sep – 9 Oct for a date on 2 Oct)', async () => {
      const { svc, prisma } = makePeriodStore([]);
      prisma.payrollVendorConfig.findUnique.mockResolvedValue({ cutoffDay: 10 });
      const result = await svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-10-02T06:00:00.000Z'));
      expect(result.periodLabel).toBe('2026-09');
      expect(result.startDate.toISOString()).toBe('2026-09-10T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2026-10-09T23:59:59.999Z');
    });

    describe('concurrent creation (P2002)', () => {
      const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

      it('returns the row the winning caller created', async () => {
        const rows: any[] = [];
        const { svc, create, findFirst } = makePeriodStore(rows, { createError: p2002() });
        const winner = OCT(PayrollPeriodStatus.OPEN);
        // first covering lookup misses; after the failed create the winner is visible
        findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

        expect(await svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-10-02T06:00:00.000Z'))).toBe(winner);
        expect(create).toHaveBeenCalledTimes(1);
      });

      it('throws ConflictException when the label is taken by a row that does not cover the date', async () => {
        const { svc } = makePeriodStore([], { createError: p2002() });
        await expect(svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-10-02T06:00:00.000Z'))).rejects.toThrow(ConflictException);
      });

      it('rethrows any non-P2002 create failure', async () => {
        const { svc } = makePeriodStore([], { createError: new Error('db down') });
        await expect(svc.ensurePeriodForDate(VENDOR_ID, new Date('2026-10-02T06:00:00.000Z'))).rejects.toThrow('db down');
      });
    });
  });
});
