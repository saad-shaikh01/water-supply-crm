import { LedgerEntryStatus, SettlementMethod, StaffLedgerCategory } from '@prisma/client';

/**
 * The nine cash-ledger buckets every ledger movement is classified into
 * (Cash Ledger redesign, Phase P0; DEPOSIT_CASH_IN/DEPOSIT_REFUND_OUT added
 * for Customer Deposits, owner-requested 2026-09-29).
 *
 *   Cash IN   : SHEET_CASH_IN     — APPROVED VanCashHandover (final amount; REVENUE ONLY —
 *                                    never includes deposit cash, see sheet-cash.util.ts)
 *               OFFICE_CASH_IN    — VanCashOpeningBalance manual entries
 *               DEPOSIT_CASH_IN   — CustomerDepositEntry COLLECT, type=CASH (both
 *                                    source=OFFICE and source=DELIVERY — a driver's
 *                                    in-delivery collection gets its own row here too)
 *   Expenses  : OFFICE_EXPENSE    — direct cash Expense (dailySheetId null, paidFromCash)
 *               PAYROLL_CASH      — ADVANCE debits that moved cash + CASH settlements
 *               CREW_CASH         — StandaloneCrewCashExpense (ACTIVE)
 *   Transfers : OWNER_TRANSFER    — OfficeCashRemittance (NOT an expense)
 *               FUEL_CARD         — FuelCardTopUp        (NOT an expense)
 *               DEPOSIT_REFUND_OUT — CustomerDepositEntry REFUND, type=CASH (both sources)
 *                                    (NOT an expense — returns a held liability, not a cost)
 *
 * Total Expenses = OFFICE_EXPENSE + PAYROLL_CASH + CREW_CASH. The transfer
 * buckets leave the office cash pool but are not costs.
 *
 * A driver's in-delivery deposit collection is DELIBERATELY excluded from
 * DailySheet.cashExpected/cashCollected (and therefore from SHEET_CASH_IN,
 * which is sourced from those via VanCashHandover) — those figures also feed
 * Analytics' "Collected Cash"/revenue-by-route, and a deposit is a liability,
 * not revenue, so folding it in would overstate collections. It's still fully
 * accounted for here as its own DEPOSIT_CASH_IN/DEPOSIT_REFUND_OUT row
 * instead, dated to the delivery. BOTTLE-type deposits never touch the Cash
 * Ledger (no cash value).
 */
export type CashLedgerBucket =
  | 'SHEET_CASH_IN'
  | 'OFFICE_CASH_IN'
  | 'DEPOSIT_CASH_IN'
  | 'OFFICE_EXPENSE'
  | 'PAYROLL_CASH'
  | 'CREW_CASH'
  | 'OWNER_TRANSFER'
  | 'FUEL_CARD'
  | 'DEPOSIT_REFUND_OUT';

/**
 * Tie-break rank for same-day/same-createdAt rows: every cash-in bucket sorts
 * BEFORE every cash-out bucket, so a same-day receipt is never folded after the
 * payout it funded (which would show an artificial negative dip).
 */
export const BUCKET_RANK: Record<CashLedgerBucket, number> = {
  SHEET_CASH_IN: 0,
  OFFICE_CASH_IN: 1,
  DEPOSIT_CASH_IN: 2,
  OFFICE_EXPENSE: 3,
  PAYROLL_CASH: 4,
  CREW_CASH: 5,
  OWNER_TRANSFER: 6,
  FUEL_CARD: 7,
  DEPOSIT_REFUND_OUT: 8,
};

export const CASH_IN_BUCKETS: readonly CashLedgerBucket[] = ['SHEET_CASH_IN', 'OFFICE_CASH_IN', 'DEPOSIT_CASH_IN'];
export const EXPENSE_BUCKETS: readonly CashLedgerBucket[] = ['OFFICE_EXPENSE', 'PAYROLL_CASH', 'CREW_CASH'];
export const TRANSFER_BUCKETS: readonly CashLedgerBucket[] = ['OWNER_TRANSFER', 'FUEL_CARD', 'DEPOSIT_REFUND_OUT'];

/**
 * R6 — of every StaffLedgerEntry, ONLY a POSTED ADVANCE or ADVANCE_DISBURSEMENT
 * debit (amount < 0) actually moved cash out of the office. ADVANCE is a plain
 * one-off advance (netted against payable in full, same period); ADVANCE_DISBURSEMENT
 * is the full-principal cash-out for an installment-recovered StaffAdvancePlan
 * (Advance Installments, 2026-09-24) — the cash leaves once, in full, on
 * disbursement day, same as any other advance. Its later recovery installments
 * (ADVANCE_RECOVERY) do NOT move cash again — that cash already left at
 * disbursement; a recovery entry is a payroll bookkeeping deduction only.
 * Everything else is a payroll-accounting entry with no cash movement of its own
 * (PENALTY, DEDUCTION, LEAVE_*, ADJUSTMENT, REVERSAL, CORRECTION, BONUS,
 * INCENTIVE, OVERTIME, EXPENSE_REIMBURSEMENT) or is its own cash source that
 * must never be read twice (CREW_CASH). PENDING / VOIDED never moved cash. A
 * positive amount on either category is a data anomaly (always a debit) and is
 * excluded.
 */
export function classifyStaffLedgerEntry(entry: {
  category: StaffLedgerCategory | string;
  status: LedgerEntryStatus | string;
  amount: number;
}): 'PAYROLL_CASH' | null {
  if (entry.category !== StaffLedgerCategory.ADVANCE && entry.category !== StaffLedgerCategory.ADVANCE_DISBURSEMENT) {
    return null;
  }
  if (entry.status !== LedgerEntryStatus.POSTED) return null;
  if (!(entry.amount < 0)) return null;
  return 'PAYROLL_CASH';
}

/** R6 — only a CASH settlement moved physical cash (BANK_TRANSFER / CHEQUE did not). */
export function isCashSettlement(method: SettlementMethod | string): boolean {
  return method === SettlementMethod.CASH;
}
