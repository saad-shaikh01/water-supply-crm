function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The monthly cycle (start/end/label) covering `reference`, anchored on
 * `cutoffDay` (the day-of-month the cycle starts). All-UTC to avoid
 * server-timezone drift. A cycle runs [cutoffDay of month M, cutoffDay - 1
 * of month M+1]; `reference` falls in month M's cycle once its day-of-month
 * reaches `cutoffDay`, otherwise it's still in the prior month's cycle.
 * `periodLabel` is the cycle's start year-month, e.g. cutoffDay=1 gives
 * plain calendar months labeled by that month.
 *
 * Shared by `PayrollPeriodService` (the attendance/wage period, anchored on
 * `PayrollVendorConfig.cutoffDay`) and `PayrollEntryService` (the optional,
 * separately-anchored cash-deduction window, `cashCutoffDay` — see the
 * schema comment on `PayrollVendorConfig`). Both callers need the exact same
 * "which monthly cycle contains this date" math, just with different
 * cutoff days and reference dates.
 */
export function computeCycleForCutoff(
  cutoffDay: number,
  reference: Date,
): { startDate: Date; endDate: Date; periodLabel: string } {
  const day = reference.getUTCDate();
  let cycleStartYear = reference.getUTCFullYear();
  let cycleStartMonth = reference.getUTCMonth();

  if (day < cutoffDay) {
    cycleStartMonth -= 1;
    if (cycleStartMonth < 0) {
      cycleStartMonth = 11;
      cycleStartYear -= 1;
    }
  }

  const startDate = new Date(Date.UTC(cycleStartYear, cycleStartMonth, cutoffDay, 0, 0, 0, 0));

  const endDate = new Date(Date.UTC(cycleStartYear, cycleStartMonth + 1, cutoffDay, 0, 0, 0, 0));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  endDate.setUTCHours(23, 59, 59, 999);

  const periodLabel = `${startDate.getUTCFullYear()}-${pad2(startDate.getUTCMonth() + 1)}`;

  return { startDate, endDate, periodLabel };
}
