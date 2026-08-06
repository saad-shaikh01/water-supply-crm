/**
 * Centralized payroll rounding helper — the single source of truth for
 * "round to the nearest whole rupee" across the payroll module (no paisa in
 * use; see the schema module note above SalaryStructure/StaffLedgerEntry in
 * libs/shared/database/prisma/schema.prisma).
 *
 * Every derived payroll calculation (this phase and later phases —
 * proration, snapshot totals, settlement math, etc.) must route through this
 * function instead of calling `Math.round` directly, so the rounding rule
 * can never drift between call sites as the module grows.
 *
 * Intentionally a thin, faithful wrapper around `Math.round`
 * (round-half-up — `Math.round(2.5) === 3`), including JS's non-symmetric
 * handling of negative halves (`Math.round(-2.5) === -2`, not -3). This
 * mirrors `Math.round` exactly rather than inventing a "round half away
 * from zero" rule nothing in the spec asked for.
 */
export function roundToNearestRupee(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundToNearestRupee: value must be a finite number, received ${value}`);
  }
  return Math.round(value);
}
