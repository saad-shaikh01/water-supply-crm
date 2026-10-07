import { roundToNearestRupee } from '../../common/helpers/payroll-rounding.util';

export interface DeductionCeilingInput {
  baseSalary: number;
  /** advances + penalties + otherDeductions, signed — negative = the employee is being charged. */
  deductionNet: number;
  /** Previous period's `deferredOut`, owed this period on top of this period's own deductions. */
  deferredIn: number;
  /** `PayrollVendorConfig.maxDeductionPercent` — null/undefined/0 = ceiling off. */
  maxDeductionPercent: number | null | undefined;
}

export interface DeductionCeilingResult {
  /** Total deduction actually charged against this period's payable (>= 0). */
  allowedDeduction: number;
  /** Deduction pushed to next period because it exceeded the ceiling (>= 0). */
  deferredOut: number;
  /** A net CREDIT in the advances/penalties/otherDeductions buckets (e.g. a correction) — added to pay, never capped. */
  netCredit: number;
}

/**
 * The one place the "max deduction % of base salary" rule lives. Used by
 * `PayrollEntryService.computeEntryBreakdown` for every path that stores a
 * payable (draft, recalculate, lock), so they can never disagree.
 *
 * With the ceiling OFF and no `deferredIn`, `allowedDeduction - netCredit`
 * equals exactly `deductionNet` — i.e. `finalPayable` is byte-identical to
 * the pre-ceiling formula `base + every bucket + carry`.
 *
 * `deferredIn` is owed on top of this period's own deductions and goes through
 * the SAME ceiling, so a large deferred amount drains over several periods
 * instead of landing in one. If the vendor later turns the ceiling off, the
 * whole backlog is charged at once — it is never stranded.
 */
export function applyDeductionCeiling(input: DeductionCeilingInput): DeductionCeilingResult {
  const owed = Math.max(0, -input.deductionNet) + Math.max(0, input.deferredIn);
  const netCredit = Math.max(0, input.deductionNet);

  const pct = input.maxDeductionPercent;
  if (!pct || pct <= 0) {
    return { allowedDeduction: owed, deferredOut: 0, netCredit };
  }

  const ceiling = Math.max(0, roundToNearestRupee((Math.max(0, input.baseSalary) * pct) / 100));
  const allowedDeduction = Math.min(owed, ceiling);
  return { allowedDeduction, deferredOut: owed - allowedDeduction, netCredit };
}
