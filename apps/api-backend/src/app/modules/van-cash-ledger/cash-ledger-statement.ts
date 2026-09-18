import type { CashLedgerBucket } from './cash-ledger-buckets';

/**
 * Per-bucket period totals. `sheetCashIn` / `officeCashIn` are net cash-in (a
 * downward handover correction can make a slice negative); every other field is
 * a positive cash-out magnitude (a negative one means a net reversal in that
 * bucket).
 */
export interface BucketTotals {
  sheetCashIn: number;
  officeCashIn: number;
  officeExpenses: number;
  payrollCash: number;
  crewCash: number;
  ownerTransfer: number;
  fuelCard: number;
}

export interface CashLedgerStatement extends BucketTotals {
  broughtForward: number;
  totalCashIn: number;
  totalExpenses: number;
  /** totalCashIn − totalExpenses − ownerTransfer − fuelCard (the period's net movement). */
  net: number;
  /** broughtForward + net. */
  expectedClosing: number;
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function emptyBucketTotals(): BucketTotals {
  return {
    sheetCashIn: 0,
    officeCashIn: 0,
    officeExpenses: 0,
    payrollCash: 0,
    crewCash: 0,
    ownerTransfer: 0,
    fuelCard: 0,
  };
}

/**
 * THE one place the statement arithmetic lives — both the row fold
 * ({@link buildStatement}) and the DB-aggregate path in VanCashLedgerService
 * (stats / availableBalance / brought-forward) go through it, so they cannot
 * disagree.
 *   Total Expenses = officeExpenses + payrollCash + crewCash
 *   (owner transfers and fuel-card top-ups are NOT expenses.)
 */
export function summarizeTotals(totals: BucketTotals, broughtForward: number): CashLedgerStatement {
  const totalCashIn = totals.sheetCashIn + totals.officeCashIn;
  const totalExpenses = totals.officeExpenses + totals.payrollCash + totals.crewCash;
  const net = totalCashIn - totalExpenses - totals.ownerTransfer - totals.fuelCard;
  return {
    broughtForward: round2(broughtForward),
    sheetCashIn: round2(totals.sheetCashIn),
    officeCashIn: round2(totals.officeCashIn),
    totalCashIn: round2(totalCashIn),
    officeExpenses: round2(totals.officeExpenses),
    payrollCash: round2(totals.payrollCash),
    crewCash: round2(totals.crewCash),
    totalExpenses: round2(totalExpenses),
    ownerTransfer: round2(totals.ownerTransfer),
    fuelCard: round2(totals.fuelCard),
    net: round2(net),
    expectedClosing: round2(broughtForward + net),
  };
}

/**
 * Folds ledger rows into a statement. `amount` is the row's SIGNED
 * contribution to the running balance (positive = cash in, negative = cash
 * out; voided rows already carry 0), which is exactly what VanCashLedgerRow
 * exposes — so the timeline, the stats and the restatement script all reuse
 * this.
 */
export function buildStatement(
  rows: ReadonlyArray<{ bucket: CashLedgerBucket; amount: number }>,
  broughtForward: number,
): CashLedgerStatement {
  const totals = emptyBucketTotals();
  for (const row of rows) {
    switch (row.bucket) {
      case 'SHEET_CASH_IN':
        totals.sheetCashIn += row.amount;
        break;
      case 'OFFICE_CASH_IN':
        totals.officeCashIn += row.amount;
        break;
      case 'OFFICE_EXPENSE':
        totals.officeExpenses -= row.amount;
        break;
      case 'PAYROLL_CASH':
        totals.payrollCash -= row.amount;
        break;
      case 'CREW_CASH':
        totals.crewCash -= row.amount;
        break;
      case 'OWNER_TRANSFER':
        totals.ownerTransfer -= row.amount;
        break;
      case 'FUEL_CARD':
        totals.fuelCard -= row.amount;
        break;
    }
  }
  return summarizeTotals(totals, broughtForward);
}
