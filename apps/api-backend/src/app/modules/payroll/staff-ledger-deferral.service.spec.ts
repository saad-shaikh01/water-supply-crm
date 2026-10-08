import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LedgerEntryStatus, PayrollPeriodStatus, StaffLedgerAuditAction, StaffLedgerCategory } from '@prisma/client';
import { StaffLedgerDeferralService } from './staff-ledger-deferral.service';
import { buildLedgerWindowFilter } from './payroll-attribution.util';

const VENDOR_ID = 'vendor-001';
const PERIOD_ID = 'period-sep';
const ENTRY_ID = 'le-1';
const admin = { userId: 'admin-1', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

const sepPeriod = {
  id: PERIOD_ID,
  vendorId: VENDOR_ID,
  periodLabel: '2026-09',
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  endDate: new Date('2026-09-30T23:59:59.999Z'),
  status: PayrollPeriodStatus.OPEN,
};

const octPeriod = {
  id: 'period-oct',
  vendorId: VENDOR_ID,
  periodLabel: '2026-10',
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-31T23:59:59.999Z'),
  status: PayrollPeriodStatus.OPEN,
};

const penalty = {
  id: ENTRY_ID,
  vendorId: VENDOR_ID,
  userId: 'emp-1',
  category: StaffLedgerCategory.PENALTY,
  amount: -3000,
  status: LedgerEntryStatus.POSTED,
  version: 4,
  payrollEntryId: null,
  payrollAttributionDate: null,
  effectiveDate: new Date('2026-09-12T00:00:00.000Z'),
  crewCashSource: null,
  standaloneCrewCashSource: null,
  discrepancyCase: null,
  attendanceLeaveSource: null,
  advancePlanDisbursementSource: null,
  advanceInstallmentSource: null,
  sheetAdvanceSource: null,
};

function makeService(opts: { period?: any; entry?: any; config?: any; claimCount?: number; stillInPeriod?: number; lockedPeriod?: any } = {}) {
  const tx: any = {
    payrollPeriod: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id) return 'period' in opts ? opts.period : sepPeriod;
        if (where?.status) return opts.lockedPeriod ?? null; // the undo-defer "any locked period at/after the original date" probe
        // refreshDraftsForMove: the period containing a given date
        const at: Date = where.startDate.lte;
        if (at >= sepPeriod.startDate && at <= sepPeriod.endDate) return sepPeriod;
        if (at >= new Date('2026-10-01T00:00:00.000Z') && at <= new Date('2026-10-31T23:59:59.999Z')) return octPeriod;
        return null;
      }),
    },
    payrollVendorConfig: { findUnique: jest.fn().mockResolvedValue(opts.config ?? null) },
    staffLedgerEntry: {
      findFirst: jest.fn().mockResolvedValue('entry' in opts ? opts.entry : penalty),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      count: jest.fn().mockResolvedValue(opts.stillInPeriod ?? 0),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...penalty, payrollAttributionDate: new Date('2026-10-01T00:00:00.000Z') }),
    },
    staffLedgerAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma: any = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };
  const payrollEntries: any = { refreshDraftEntryTx: jest.fn().mockResolvedValue(true) };
  return { svc: new StaffLedgerDeferralService(prisma, payrollEntries), tx, payrollEntries };
}

const deferDto = { periodId: PERIOD_ID, version: 4, reason: 'Employee short on cash this month' };

describe('StaffLedgerDeferralService.defer()', () => {
  it('moves ONLY payrollAttributionDate to the next period (effectiveDate untouched), bumps version, and audits with the reason', async () => {
    const { svc, tx } = makeService();
    await svc.defer(admin, ENTRY_ID, deferDto);

    expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith({
      where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 4, payrollEntryId: null, status: LedgerEntryStatus.POSTED },
      data: { payrollAttributionDate: new Date('2026-10-01T00:00:00.000Z'), version: { increment: 1 } },
    });
    const data = tx.staffLedgerEntry.updateMany.mock.calls[0][0].data;
    expect('effectiveDate' in data).toBe(false);

    expect(tx.staffLedgerAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ledgerEntryId: ENTRY_ID,
        actorId: admin.userId,
        action: StaffLedgerAuditAction.EDITED,
        reason: expect.stringContaining('Employee short on cash this month'),
        afterJson: { payrollAttributionDate: new Date('2026-10-01T00:00:00.000Z') },
      }),
    });
  });

  it('refreshes the employee DRAFT entry of BOTH periods the move touches (the one it leaves, the one that now owns it) in the same transaction', async () => {
    const { svc, tx, payrollEntries } = makeService();
    await svc.defer(admin, ENTRY_ID, deferDto);
    const refreshed = payrollEntries.refreshDraftEntryTx.mock.calls.map((c: any[]) => [c[0] === tx, c[2], c[3].id]);
    expect(refreshed).toEqual([
      [true, 'emp-1', 'period-sep'],
      [true, 'emp-1', 'period-oct'],
    ]);
  });

  it('does not refresh anything when the move is refused', async () => {
    const { svc, payrollEntries } = makeService({ claimCount: 0 });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(ConflictException);
    expect(payrollEntries.refreshDraftEntryTx).not.toHaveBeenCalled();
  });

  it('finds the entry through the SAME window filter the draft/breakdown use, scoped to the vendor', async () => {
    const { svc, tx } = makeService();
    await svc.defer(admin, ENTRY_ID, deferDto);
    expect(tx.staffLedgerEntry.findFirst.mock.calls[0][0].where).toEqual({
      id: ENTRY_ID,
      vendorId: VENDOR_ID,
      AND: [buildLedgerWindowFilter(sepPeriod, null)],
    });
  });

  it('uses the next cash cycle for a category redirected to the cash-deduction window', async () => {
    const { svc, tx } = makeService({
      entry: { ...penalty, category: StaffLedgerCategory.ADVANCE },
      config: { cutoffDay: 1, cashCutoffDay: 10, cashWindowCategories: [StaffLedgerCategory.ADVANCE] },
    });
    await svc.defer(admin, ENTRY_ID, deferDto);
    expect(tx.staffLedgerEntry.updateMany.mock.calls[0][0].data.payrollAttributionDate).toEqual(
      new Date('2026-10-10T00:00:00.000Z'),
    );
  });

  it('works for an ADVANCE (the cash already left on effectiveDate, which stays put)', async () => {
    const { svc, tx } = makeService({ entry: { ...penalty, category: StaffLedgerCategory.ADVANCE } });
    await svc.defer(admin, ENTRY_ID, deferDto);
    expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalled();
  });

  it('404s when the period is not this vendor\'s', async () => {
    const { svc } = makeService({ period: null });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(NotFoundException);
  });

  it.each([PayrollPeriodStatus.LOCKED, PayrollPeriodStatus.PAID])('refuses when the period is %s', async (status) => {
    const { svc, tx } = makeService({ period: { ...sepPeriod, status } });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(BadRequestException);
    expect(tx.staffLedgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it('404s when the entry is not part of that period (it is not what the admin is looking at)', async () => {
    const { svc, tx } = makeService({ entry: null });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(NotFoundException);
    expect(tx.staffLedgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['not POSTED', { status: LedgerEntryStatus.PENDING }],
    ['already rolled into locked payroll', { payrollEntryId: 'pe-1' }],
    ['a credit, not a deduction', { amount: 500 }],
    ['zero amount', { amount: 0 }],
    ['an ADVANCE_DISBURSEMENT (never reaches a bucket)', { category: StaffLedgerCategory.ADVANCE_DISBURSEMENT }],
    ['a REVERSAL', { category: StaffLedgerCategory.REVERSAL }],
    ['a CORRECTION', { category: StaffLedgerCategory.CORRECTION }],
    ['crew cash', { crewCashSource: { id: 'c' } }],
    ['standalone crew cash', { standaloneCrewCashSource: { id: 'c' } }],
    ['a discrepancy case', { discrepancyCase: { id: 'd' } }],
    ['an attendance deduction (waive/reset the day instead)', { attendanceLeaveSource: { id: 'a' } }],
    ['an advance-plan disbursement', { advancePlanDisbursementSource: { id: 'p' } }],
    ['an advance-plan installment (skip it there)', { advanceInstallmentSource: { id: 'i' } }],
    ['a daily-sheet advance', { sheetAdvanceSource: { id: 's' } }],
  ])('refuses an entry that is %s, writing nothing', async (_label, patch) => {
    const { svc, tx } = makeService({ entry: { ...penalty, ...patch } });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(BadRequestException);
    expect(tx.staffLedgerEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.staffLedgerAuditLog.create).not.toHaveBeenCalled();
  });

  it('409s on a stale version', async () => {
    const { svc, tx } = makeService({ claimCount: 0 });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(ConflictException);
    expect(tx.staffLedgerAuditLog.create).not.toHaveBeenCalled();
  });

  it('rolls back (throws) if the new date would still land in the SAME period - a deferral that does nothing is refused, not faked', async () => {
    const { svc, tx } = makeService({ stillInPeriod: 1 });
    await expect(svc.defer(admin, ENTRY_ID, deferDto)).rejects.toThrow(BadRequestException);
    expect(tx.staffLedgerAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('StaffLedgerDeferralService.undoDefer()', () => {
  const deferred = { ...penalty, payrollAttributionDate: new Date('2026-10-01T00:00:00.000Z') };
  const undoDto = { version: 4, reason: 'Changed my mind' };

  it('clears the attribution date, bumps version, audits - and refreshes the drafts of the period it leaves and the one it returns to', async () => {
    const { svc, tx, payrollEntries } = makeService({ entry: deferred });
    await svc.undoDefer(admin, ENTRY_ID, undoDto);
    expect(payrollEntries.refreshDraftEntryTx.mock.calls.map((c: any[]) => c[3].id)).toEqual(['period-oct', 'period-sep']);
    expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith({
      where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 4, payrollEntryId: null, status: LedgerEntryStatus.POSTED },
      data: { payrollAttributionDate: null, version: { increment: 1 } },
    });
    expect(tx.staffLedgerAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: StaffLedgerAuditAction.EDITED,
        reason: expect.stringContaining('Changed my mind'),
        afterJson: { payrollAttributionDate: null },
      }),
    });
  });

  it('refuses an entry that was never deferred', async () => {
    const { svc } = makeService({ entry: penalty });
    await expect(svc.undoDefer(admin, ENTRY_ID, undoDto)).rejects.toThrow(BadRequestException);
  });

  it('404s for an unknown / other-vendor entry', async () => {
    const { svc } = makeService({ entry: null });
    await expect(svc.undoDefer(admin, ENTRY_ID, undoDto)).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['rolled into locked payroll', { payrollEntryId: 'pe-1' }],
    ['no longer POSTED', { status: LedgerEntryStatus.VOIDED }],
  ])('refuses an entry that is %s', async (_label, patch) => {
    const { svc, tx } = makeService({ entry: { ...deferred, ...patch } });
    await expect(svc.undoDefer(admin, ENTRY_ID, undoDto)).rejects.toThrow(BadRequestException);
    expect(tx.staffLedgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to put the entry back when its original period has since been LOCKED - it would never be claimed and the deduction would silently vanish', async () => {
    const { svc, tx } = makeService({ entry: deferred, lockedPeriod: { periodLabel: '2026-09' } });
    await expect(svc.undoDefer(admin, ENTRY_ID, undoDto)).rejects.toThrow(/already locked/);
    expect(tx.staffLedgerEntry.updateMany).not.toHaveBeenCalled();
  });

  it('409s on a stale version', async () => {
    const { svc } = makeService({ entry: deferred, claimCount: 0 });
    await expect(svc.undoDefer(admin, ENTRY_ID, undoDto)).rejects.toThrow(ConflictException);
  });
});
