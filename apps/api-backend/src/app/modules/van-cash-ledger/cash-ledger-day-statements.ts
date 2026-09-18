import type { CashLedgerBucket } from './cash-ledger-buckets';
import type { CashLedgerDayStatement } from './cash-ledger-contract';
import { pktDay } from './cash-ledger-sort';
import { buildStatement } from './cash-ledger-statement';

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** UTC-noon of a YYYY-MM-DD string — noon so a whole-day diff can never straddle a DST/offset edge. */
function noonUtc(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * Whole PKT calendar days between the day a record was CREATED and the business
 * day it is dated: `createdDay − businessDay`. 0 = same day, > 0 = backdated,
 * < 0 = future-dated. Pure string/UTC-noon arithmetic on the two PKT day keys —
 * independent of the server process timezone.
 */
export function computeLagDays(createdAtIso: string, dateIso: string): number {
  return Math.round((noonUtc(pktDay(createdAtIso)) - noonUtc(pktDay(dateIso))) / DAY_MS);
}

/** Minimal row shape the per-day fold reads (structurally satisfied by VanCashLedgerRow). */
export interface DayStatementRow {
  date: string;
  bucket: CashLedgerBucket;
  amount: number;
  lagDays: number;
}

/**
 * Per-PKT-day statements over rows already in ledger order (oldest first, see
 * cash-ledger-sort.ts). `opening` of the first day is `broughtForward`; each
 * later day opens at the previous day's closing; `closing = opening + net`
 * (buildStatement semantics — cash-out buckets are positive magnitudes and the
 * two transfer buckets are kept apart from expenses).
 *
 * Only days WITH at least one row are emitted (a day is a group of rows dated
 * that PKT day, voided rows included), ascending.
 */
export function buildDayStatements(
  rowsOldestFirst: ReadonlyArray<DayStatementRow>,
  broughtForward: number,
): CashLedgerDayStatement[] {
  const groups = new Map<string, DayStatementRow[]>();
  for (const row of rowsOldestFirst) {
    const day = pktDay(row.date);
    const bucket = groups.get(day);
    if (bucket) bucket.push(row);
    else groups.set(day, [row]);
  }

  const out: CashLedgerDayStatement[] = [];
  let opening = round2(broughtForward);
  for (const day of [...groups.keys()].sort()) {
    const dayRows = groups.get(day) as DayStatementRow[];
    const s = buildStatement(dayRows, 0);
    const closing = round2(opening + s.net);
    out.push({
      date: day,
      opening,
      sheetCashIn: s.sheetCashIn,
      officeCashIn: s.officeCashIn,
      totalCashIn: s.totalCashIn,
      officeExpenses: s.officeExpenses,
      payrollCash: s.payrollCash,
      crewCash: s.crewCash,
      totalExpenses: s.totalExpenses,
      ownerTransfer: s.ownerTransfer,
      fuelCard: s.fuelCard,
      net: s.net,
      closing,
      entryCount: dayRows.length,
      lateCount: dayRows.filter((r) => r.lagDays > 0).length,
    });
    opening = closing;
  }
  return out;
}
