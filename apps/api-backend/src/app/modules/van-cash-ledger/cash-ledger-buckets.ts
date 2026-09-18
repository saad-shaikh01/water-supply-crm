import { LedgerEntryStatus, SettlementMethod, StaffLedgerCategory } from '@prisma/client';

/**
 * The seven cash-ledger buckets every ledger movement is classified into
 * (Cash Ledger redesign, Phase P0).
 *
 *   Cash IN   : SHEET_CASH_IN   — APPROVED VanCashHandover (final amount)
 *               OFFICE_CASH_IN  — VanCashOpeningBalance manual entries
 *   Expenses  : OFFICE_EXPENSE  — direct cash Expense (dailySheetId null, paidFromCash)
 *               PAYROLL_CASH    — ADVANCE debits that moved cash + CASH settlements
 *               CREW_CASH       — StandaloneCrewCashExpense (ACTIVE)
 *   Transfers : OWNER_TRANSFER  — OfficeCashRemittance (NOT an expense)
 *               FUEL_CARD       — FuelCardTopUp        (NOT an expense)
 *
 * Total Expenses = OFFICE_EXPENSE + PAYROLL_CASH + CREW_CASH. The two transfer
 * buckets leave the office cash pool but are not costs.
 */
export type CashLedgerBucket =
  | 'SHEET_CASH_IN'
  | 'OFFICE_CASH_IN'
  | 'OFFICE_EXPENSE'
  | 'PAYROLL_CASH'
  | 'CREW_CASH'
  | 'OWNER_TRANSFER'
  | 'FUEL_CARD';

/**
 * Tie-break rank for same-day/same-createdAt rows: every cash-in bucket sorts
 * BEFORE every cash-out bucket, so a same-day receipt is never folded after the
 * payout it funded (which would show an artificial negative dip).
 */
export const BUCKET_RANK: Record<CashLedgerBucket, number> = {
  SHEET_CASH_IN: 0,
  OFFICE_CASH_IN: 1,
  OFFICE_EXPENSE: 2,
  PAYROLL_CASH: 3,
  CREW_CASH: 4,
  OWNER_TRANSFER: 5,
  FUEL_CARD: 6,
};

export const CASH_IN_BUCKETS: readonly CashLedgerBucket[] = ['SHEET_CASH_IN', 'OFFICE_CASH_IN'];
export const EXPENSE_BUCKETS: readonly CashLedgerBucket[] = ['OFFICE_EXPENSE', 'PAYROLL_CASH', 'CREW_CASH'];
export const TRANSFER_BUCKETS: readonly CashLedgerBucket[] = ['OWNER_TRANSFER', 'FUEL_CARD'];

/**
 * R6 — of every StaffLedgerEntry, ONLY a POSTED ADVANCE debit (amount < 0)
 * actually moved cash out of the office. Everything else is a payroll-accounting
 * entry with no cash movement of its own (PENALTY, DEDUCTION, LEAVE_*,
 * ADJUSTMENT, REVERSAL, CORRECTION, BONUS, INCENTIVE, OVERTIME,
 * EXPENSE_REIMBURSEMENT) or is its own cash source that must never be read
 * twice (CREW_CASH). PENDING / VOIDED never moved cash. A positive ADVANCE is a
 * data anomaly (an advance is always a debit) and is excluded.
 */
export function classifyStaffLedgerEntry(entry: {
  category: StaffLedgerCategory | string;
  status: LedgerEntryStatus | string;
  amount: number;
}): 'PAYROLL_CASH' | null {
  if (entry.category !== StaffLedgerCategory.ADVANCE) return null;
  if (entry.status !== LedgerEntryStatus.POSTED) return null;
  if (!(entry.amount < 0)) return null;
  return 'PAYROLL_CASH';
}

/** R6 — only a CASH settlement moved physical cash (BANK_TRANSFER / CHEQUE did not). */
export function isCashSettlement(method: SettlementMethod | string): boolean {
  return method === SettlementMethod.CASH;
}
