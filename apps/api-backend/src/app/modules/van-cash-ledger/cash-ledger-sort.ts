import { vendorDateString } from '../../common/helpers/date.util';
import { BUCKET_RANK, type CashLedgerBucket } from './cash-ledger-buckets';

/** The minimal row shape the comparator needs (structurally satisfied by VanCashLedgerRow). */
export interface SortableLedgerRow {
  /** ISO timestamp of the movement. */
  date: string;
  /** ISO timestamp the source record was created. */
  createdAt: string;
  bucket: CashLedgerBucket;
  id: string;
}

const dayCache = new Map<string, string>();

/** PKT (Asia/Karachi) calendar day of an ISO timestamp, YYYY-MM-DD. Memoised — a sort calls this O(n log n) times. */
export function pktDay(iso: string): string {
  let day = dayCache.get(iso);
  if (day === undefined) {
    day = vendorDateString(new Date(iso));
    if (dayCache.size > 50_000) dayCache.clear();
    dayCache.set(iso, day);
  }
  return day;
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Deterministic ledger order (oldest first):
 *   PKT calendar day of `date` asc → `createdAt` asc → bucket rank
 *   (cash-in buckets before cash-out buckets) → `id`.
 *
 * Replaces the old `date`-string + `id`-string sort, which was arbitrary for
 * rows sharing a `date` (e.g. date-only sheet dates / manual entries) and could
 * fold a payout before the receipt that funded it.
 */
export function compareLedgerRows(a: SortableLedgerRow, b: SortableLedgerRow): number {
  const dayA = pktDay(a.date);
  const dayB = pktDay(b.date);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;

  const createdA = timeOf(a.createdAt);
  const createdB = timeOf(b.createdAt);
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;

  const rankA = BUCKET_RANK[a.bucket];
  const rankB = BUCKET_RANK[b.bucket];
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;

  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Returns a new array sorted with {@link compareLedgerRows}. */
export function sortLedgerRows<T extends SortableLedgerRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareLedgerRows);
}
