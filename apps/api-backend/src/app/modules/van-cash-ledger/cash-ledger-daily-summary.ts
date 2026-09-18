import { vendorTodayString } from '../../common/helpers/date.util';
import type {
  CashLedgerDailySummary,
  CashLedgerDayStatement,
  CashLedgerPeriodRow,
  CashLedgerStatementTotals,
  CashLedgerSummaryGroup,
} from './cash-ledger-contract';
import { buildDayStatements, type DayStatementRow } from './cash-ledger-day-statements';
import { pktDay } from './cash-ledger-sort';
import { buildStatement } from './cash-ledger-statement';

/**
 * Cash Ledger P3 — the table view (`GET /van-cash-ledger/daily-summary`).
 *
 * PURE: turns the window's already-collected ledger rows into one reconciliation
 * row per PKT day / Monday-start week / calendar month. Every figure comes from
 * the SAME `buildDayStatements` / `buildStatement` the timeline and summary use,
 * so the table can never disagree with them (invariant I1). All date arithmetic
 * is done on YYYY-MM-DD strings through UTC-noon Dates — never the server TZ.
 */

/** Server-side cap on returned rows (applied AFTER grouping; the OLDEST rows are dropped). */
export const DAILY_SUMMARY_ROW_CAP = 366;

/** Minimal row shape the builder reads (structurally satisfied by VanCashLedgerRow). */
export interface DailySummaryRow extends DayStatementRow {
  /** ISO timestamp the source record was created. */
  createdAt: string;
  isEdited: boolean;
  isVoided?: boolean;
}

export interface BuildDailySummaryInput {
  /** Window rows, oldest first (ledger order). */
  rows: ReadonlyArray<DailySummaryRow>;
  broughtForward: number;
  /** Requested PKT day (YYYY-MM-DD); absent -> derived. */
  from?: string | null;
  /** Requested PKT day (YYYY-MM-DD); absent -> derived. */
  to?: string | null;
  group: CashLedgerSummaryGroup;
  includeEmpty: boolean;
  /** PKT day (YYYY-MM-DD) of every pending memo item (handover / owner transfer) in the window. */
  pendingDays: ReadonlyArray<string>;
  /** Override "today" (PKT day) — tests only. */
  today?: string;
}

export type DailySummaryResult = Pick<CashLedgerDailySummary, 'rows' | 'totals' | 'truncated'>;

// ── YYYY-MM-DD string arithmetic (UTC-noon Dates) ───────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const EN_DASH = '–';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function noonUtc(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysStr(day: string, n: number): string {
  return fmt(new Date(noonUtc(day).getTime() + n * DAY_MS));
}

/** Monday (YYYY-MM-DD) of the Monday-start week containing `day`. */
function mondayOf(day: string): string {
  const dow = noonUtc(day).getUTCDay(); // 0 = Sunday
  return addDaysStr(day, -((dow + 6) % 7));
}

/** Last calendar day of the month containing `day`. */
function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return fmt(new Date(Date.UTC(y, m, 0, 12)));
}

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "Wed, 8 Jul 2026" */
export function labelDay(day: string): string {
  const { y, m, d } = parts(day);
  return `${WEEKDAYS[noonUtc(day).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Jul 2026" */
export function labelMonth(day: string): string {
  const { y, m } = parts(day);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "6 – 12 Jul 2026" / "29 Jun – 5 Jul 2026" / "29 Dec 2026 – 4 Jan 2027" / "8 Jul 2026" (single day). */
export function labelRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} ${EN_DASH} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} ${EN_DASH} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} ${EN_DASH} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

// ── Grouping ────────────────────────────────────────────────────────────────

function bucketKey(day: string, group: CashLedgerSummaryGroup): string {
  if (group === 'week') return mondayOf(day);
  if (group === 'month') return day.slice(0, 7);
  return day;
}

/** Unclamped inclusive PKT bounds of a bucket. */
function bucketBounds(key: string, group: CashLedgerSummaryGroup): { from: string; to: string } {
  if (group === 'week') return { from: key, to: addDaysStr(key, 6) };
  if (group === 'month') return { from: `${key}-01`, to: monthEnd(`${key}-01`) };
  return { from: key, to: key };
}

const FIGURE_KEYS = [
  'sheetCashIn',
  'officeCashIn',
  'totalCashIn',
  'officeExpenses',
  'payrollCash',
  'crewCash',
  'totalExpenses',
  'ownerTransfer',
  'fuelCard',
  'net',
] as const satisfies ReadonlyArray<keyof CashLedgerStatementTotals>;

/** One PKT day, with or without ledger activity. */
type DayFigures = Pick<CashLedgerDayStatement, (typeof FIGURE_KEYS)[number] | 'opening' | 'closing' | 'entryCount' | 'lateCount'>;

function zeroDay(carry: number): DayFigures {
  return {
    opening: carry,
    closing: carry,
    sheetCashIn: 0,
    officeCashIn: 0,
    totalCashIn: 0,
    officeExpenses: 0,
    payrollCash: 0,
    crewCash: 0,
    totalExpenses: 0,
    ownerTransfer: 0,
    fuelCard: 0,
    net: 0,
    entryCount: 0,
    lateCount: 0,
  };
}

interface BucketAcc {
  key: string;
  opening: number;
  closing: number;
  sums: Record<(typeof FIGURE_KEYS)[number], number>;
  entryCount: number;
  lateCount: number;
  editedCount: number;
  voidedCount: number;
  pendingCount: number;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Every YYYY-MM-DD in [from, to] inclusive, ascending (empty when from > to). */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDaysStr(day, 1)) out.push(day);
  return out;
}

/**
 * Builds the table: `rows` newest-first (capped at {@link DAILY_SUMMARY_ROW_CAP}
 * after grouping, oldest dropped -> `truncated`) plus the whole-range `totals`
 * (which are NEVER affected by the cap and equal `GET /summary`'s statement).
 *
 * Range derivation when a bound is absent: `from` = first row's PKT day,
 * `to` = today (PKT). Both are widened to also cover any window row / pending
 * item outside them (future-dated entries, or pending items with no `from`), so
 * the rows always sum to the totals.
 */
export function buildDailySummary(input: BuildDailySummaryInput): DailySummaryResult {
  const { rows, broughtForward, group, includeEmpty, pendingDays } = input;

  const dayStatements = buildDayStatements(rows, broughtForward);
  const statementByDay = new Map<string, CashLedgerDayStatement>(dayStatements.map((s) => [s.date, s]));

  // Per-day counters the day statement doesn't carry.
  const editedByDay = new Map<string, number>();
  const voidedByDay = new Map<string, number>();
  const recordedByBucket = new Map<string, number>();
  for (const row of rows) {
    const day = pktDay(row.date);
    if (row.isEdited) increment(editedByDay, day);
    if (row.isVoided) increment(voidedByDay, day);
    increment(recordedByBucket, bucketKey(pktDay(row.createdAt), group));
  }
  const pendingByDay = new Map<string, number>();
  for (const day of pendingDays) increment(pendingByDay, day);

  // Effective range.
  const activityDays = [...new Set([...statementByDay.keys(), ...pendingByDay.keys()])].sort();
  const firstActive: string | undefined = activityDays[0];
  const lastActive: string | undefined = activityDays[activityDays.length - 1];
  const today = input.today ?? vendorTodayString();
  const rangeFrom = input.from || firstActive || input.to || today;
  const rangeTo = maxDay(input.to || maxDay(today, lastActive ?? today), rangeFrom);

  // The day list: every day in the range (includeEmpty) or only days with activity / pending — always
  // a superset of the days that carry a statement so nothing can fall out of the sums.
  const dayList = includeEmpty
    ? [...new Set([...eachDay(rangeFrom, rangeTo), ...activityDays])].sort()
    : activityDays;

  // Walk oldest -> newest carrying the balance across zero-activity days.
  const buckets = new Map<string, BucketAcc>();
  let carry = round2(broughtForward);
  for (const day of dayList) {
    const statement = statementByDay.get(day);
    const figures: DayFigures = statement ?? zeroDay(carry);
    const key = bucketKey(day, group);
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        key,
        opening: figures.opening,
        closing: figures.closing,
        sums: Object.fromEntries(FIGURE_KEYS.map((k) => [k, 0])) as BucketAcc['sums'],
        entryCount: 0,
        lateCount: 0,
        editedCount: 0,
        voidedCount: 0,
        pendingCount: 0,
      };
      buckets.set(key, acc);
    }
    acc.closing = figures.closing;
    for (const k of FIGURE_KEYS) acc.sums[k] += figures[k];
    acc.entryCount += figures.entryCount;
    acc.lateCount += figures.lateCount;
    acc.editedCount += editedByDay.get(day) ?? 0;
    acc.voidedCount += voidedByDay.get(day) ?? 0;
    acc.pendingCount += pendingByDay.get(day) ?? 0;
    carry = figures.closing;
  }

  const ascending: CashLedgerPeriodRow[] = [...buckets.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((acc) => {
      const bounds = bucketBounds(acc.key, group);
      const from = maxDay(bounds.from, rangeFrom);
      const to = minDay(bounds.to, rangeTo);
      const label = group === 'day' ? labelDay(acc.key) : group === 'month' ? labelMonth(bounds.from) : labelRange(from, to);
      return {
        key: acc.key,
        label,
        from,
        to,
        opening: round2(acc.opening),
        closing: round2(acc.closing),
        sheetCashIn: round2(acc.sums.sheetCashIn),
        officeCashIn: round2(acc.sums.officeCashIn),
        totalCashIn: round2(acc.sums.totalCashIn),
        officeExpenses: round2(acc.sums.officeExpenses),
        payrollCash: round2(acc.sums.payrollCash),
        crewCash: round2(acc.sums.crewCash),
        totalExpenses: round2(acc.sums.totalExpenses),
        ownerTransfer: round2(acc.sums.ownerTransfer),
        fuelCard: round2(acc.sums.fuelCard),
        net: round2(acc.sums.net),
        entryCount: acc.entryCount,
        recordedCount: recordedByBucket.get(acc.key) ?? 0,
        lateCount: acc.lateCount,
        editedCount: acc.editedCount,
        voidedCount: acc.voidedCount,
        pendingCount: acc.pendingCount,
        isEmpty: acc.entryCount === 0 && acc.pendingCount === 0,
      };
    });

  const newestFirst = ascending.reverse();
  const truncated = newestFirst.length > DAILY_SUMMARY_ROW_CAP;

  // Whole-range totals: the SAME buildStatement fold getSummary() uses (I1).
  const statement = buildStatement(rows, broughtForward);
  return {
    rows: truncated ? newestFirst.slice(0, DAILY_SUMMARY_ROW_CAP) : newestFirst,
    truncated,
    totals: {
      broughtForward: statement.broughtForward,
      sheetCashIn: statement.sheetCashIn,
      officeCashIn: statement.officeCashIn,
      totalCashIn: statement.totalCashIn,
      officeExpenses: statement.officeExpenses,
      payrollCash: statement.payrollCash,
      crewCash: statement.crewCash,
      totalExpenses: statement.totalExpenses,
      ownerTransfer: statement.ownerTransfer,
      fuelCard: statement.fuelCard,
      net: statement.net,
      expectedClosing: statement.expectedClosing,
      entryCount: rows.length,
      lateCount: rows.filter((row) => row.lagDays > 0).length,
      pendingCount: pendingDays.length,
    },
  };
}
