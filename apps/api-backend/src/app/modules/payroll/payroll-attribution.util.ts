import { AttendanceStatus, LedgerEntryStatus, Prisma, StaffLedgerCategory } from '@prisma/client';
import { computeCycleForCutoff } from './payroll-cycle.util';

export interface DateRange {
  gte: Date;
  lte: Date;
}

/**
 * "This ledger row belongs to the window `range`" — by its payroll attribution
 * date when it has been deferred ("deduct next month"), otherwise by its plain
 * `effectiveDate` exactly as before. The single definition used by every
 * payroll query that decides which period claims a row, so the amounts summed
 * and the rows shown can never disagree.
 */
export function attributedWithin(range: DateRange): Prisma.StaffLedgerEntryWhereInput {
  return {
    OR: [{ payrollAttributionDate: null, effectiveDate: range }, { payrollAttributionDate: range }],
  };
}

export interface CashWindow {
  startDate: Date;
  endDate: Date;
  categories: StaffLedgerCategory[];
}

/**
 * Which ledger rows a payroll period claims — the ONE definition shared by the
 * amounts summed (`computeLedgerContribution`), the rows displayed
 * (`getBreakdown`) and the deferral service's "does this row currently belong
 * to this period" check. `cashWindow == null` (every vendor that has not opted
 * in) is the single attendance-period window.
 */
export function buildLedgerWindowFilter(
  period: { startDate: Date; endDate: Date },
  cashWindow: CashWindow | null,
): Prisma.StaffLedgerEntryWhereInput {
  const periodRange = { gte: period.startDate, lte: period.endDate };
  if (!cashWindow) return attributedWithin(periodRange);
  return {
    OR: [
      { AND: [{ category: { in: cashWindow.categories } }, attributedWithin({ gte: cashWindow.startDate, lte: cashWindow.endDate })] },
      { AND: [{ category: { notIn: cashWindow.categories } }, attributedWithin(periodRange)] },
    ],
  };
}

/**
 * An unpaid-status attendance day nobody has decided on yet: no live
 * (non-VOIDED) deduction posted for it and not explicitly waived. A VOIDED
 * leave entry counts as undecided again — the money is no longer being charged.
 */
export const PENDING_ABSENCE_WHERE: Prisma.StaffAttendanceWhereInput = {
  status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
  deductionWaivedAt: null,
  OR: [{ leaveLedgerEntryId: null }, { leaveLedgerEntry: { status: LedgerEntryStatus.VOIDED } }],
};

/**
 * The date a deferred entry is re-attributed to so that the NEXT payroll period
 * (and not the current one again) claims it.
 *
 * Normally that is simply the day after the current period ends. A category
 * the vendor has redirected to the separate cash-deduction window is claimed by
 * that window's cycle instead, and "the day after the attendance period ends"
 * can still sit in the SAME cash cycle (attendance = calendar month, cash
 * cutoff = 10th: Oct 1 is still in Sep-10..Oct-9) — so for those categories the
 * target is the start of the cash cycle that the next period will use.
 */
export function computeDeferralTarget(opts: {
  periodEnd: Date;
  cutoffDay: number;
  cashCutoffDay: number | null;
  cashWindowCategories: StaffLedgerCategory[];
  category: StaffLedgerCategory;
}): Date {
  const nextStart = new Date(
    Date.UTC(opts.periodEnd.getUTCFullYear(), opts.periodEnd.getUTCMonth(), opts.periodEnd.getUTCDate() + 1),
  );
  if (opts.cashCutoffDay && opts.cashWindowCategories.includes(opts.category)) {
    const nextPeriodEnd = computeCycleForCutoff(opts.cutoffDay, nextStart).endDate;
    return computeCycleForCutoff(opts.cashCutoffDay, nextPeriodEnd).startDate;
  }
  return nextStart;
}
