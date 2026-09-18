import { compareLedgerRows, type SortableLedgerRow } from './cash-ledger-sort';

/**
 * Cash Ledger P3 — PENDING memo rows (handovers / owner transfers awaiting
 * approval). They are shown only when the status filter asks for PENDING, and
 * they are MEMO rows: `amount` is 0 (the real figure lives in `displayAmount`),
 * so they can never move a running balance, a day statement or the filtered
 * subtotal. Pure — no DB.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Merges `pending` memo rows into the already-folded `base` rows (oldest first,
 * `runningBalance` set) in ledger order. Each pending row's `runningBalance` is
 * the running balance of the closest preceding BASE row (or `broughtForward`
 * when none precedes it). Base rows are left untouched — same order, same
 * balances. Returns a new array; `base` itself is not modified.
 */
export function mergePendingRows<T extends SortableLedgerRow & { runningBalance: number }>(
  base: readonly T[],
  pending: readonly T[],
  broughtForward: number,
): T[] {
  if (pending.length === 0) return [...base];
  const baseRows = new Set<T>(base);
  const merged = [...base, ...pending].sort(compareLedgerRows);
  let running = round2(broughtForward);
  for (const row of merged) {
    if (baseRows.has(row)) running = row.runningBalance;
    else row.runningBalance = running;
  }
  return merged;
}
