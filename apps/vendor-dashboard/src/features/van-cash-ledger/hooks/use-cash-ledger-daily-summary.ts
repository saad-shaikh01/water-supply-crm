import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useQueryState, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs';
import {
  vanCashLedgerApi,
  type CashLedgerDailySummaryQuery,
  type CashLedgerDayStatement,
  type CashLedgerPeriodRow,
  type CashLedgerSummaryGroup,
  type CashLedgerTimelineQuery,
} from '../api/van-cash-ledger.api';
import { resolveCashLedgerRange } from './use-van-cash-ledger';
import { parseYmd, pktToday } from '../../../lib/date-pkt';

/** Same root as every other Cash Ledger key, so the page's `INVALIDATE_ALL` / Refresh button refetches the table too. */
const QUERY_KEY = 'van-cash-ledger';

export const CASH_LEDGER_SUMMARY_GROUPS = ['day', 'week', 'month'] as const;
export const CASH_LEDGER_TABLE_COLUMN_SETS = ['reconciliation', 'compact', 'audit'] as const;
export type CashLedgerTableColumnSet = (typeof CASH_LEDGER_TABLE_COLUMN_SETS)[number];

const COLS_STORAGE_KEY = 'wsc:cash-ledger:table-cols';

/** Ranges longer than this many days default to weekly / monthly buckets (server caps day rows at 366). */
const AUTO_WEEK_OVER_DAYS = 92;
const AUTO_MONTH_OVER_DAYS = 366;

/** Inclusive number of calendar days in [from, to]; NaN when either bound is malformed. */
function spanDays(from: string, to: string): number {
  const a = parseYmd(from);
  const b = parseYmd(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) + 1;
}

/**
 * Bucket size used when the URL has no `tgroup`: > 366 days → month, > 92 days → week, else day.
 * An open-ended range (no `from`) can't be measured, so it stays on days.
 */
export function autoSummaryGroup(from?: string, to?: string): CashLedgerSummaryGroup {
  if (!from) return 'day';
  const days = spanDays(from, to || pktToday());
  if (!Number.isFinite(days)) return 'day';
  if (days > AUTO_MONTH_OVER_DAYS) return 'month';
  if (days > AUTO_WEEK_OVER_DAYS) return 'week';
  return 'day';
}

function readStoredColumns(): CashLedgerTableColumnSet | null {
  try {
    const v = window.localStorage.getItem(COLS_STORAGE_KEY);
    return v === 'reconciliation' || v === 'compact' || v === 'audit' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Table-view state (spec §4.8). Everything lives in the URL so a link shares the
 * exact table; the column set is additionally remembered per browser.
 *   tgroup  day | week | month — absent = AUTO from the range length
 *   tempty  show zero-activity days (absent = off)
 *   tcols   reconciliation | compact | audit — absent = the remembered choice, else reconciliation
 * Every storage access is try/catch-guarded (private windows just fall back to the default).
 */
export function useCashLedgerTableState() {
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const range = resolveCashLedgerRange(from, to);

  const [groupParam, setGroupParam] = useQueryState('tgroup', parseAsStringLiteral(CASH_LEDGER_SUMMARY_GROUPS));
  const [emptyParam, setEmptyParam] = useQueryState('tempty', parseAsBoolean.withDefault(false));
  const [colsParam, setColsParam] = useQueryState('tcols', parseAsStringLiteral(CASH_LEDGER_TABLE_COLUMN_SETS));

  // The remembered column set is read after mount so the first paint always matches the server render.
  const [storedCols, setStoredCols] = useState<CashLedgerTableColumnSet | null>(null);
  useEffect(() => {
    setStoredCols(readStoredColumns());
  }, []);

  const autoGroup = autoSummaryGroup(range.from, range.to);
  const group: CashLedgerSummaryGroup = groupParam ?? autoGroup;
  const columns: CashLedgerTableColumnSet = colsParam ?? storedCols ?? 'reconciliation';

  const setGroup = (next: CashLedgerSummaryGroup) => {
    void setGroupParam(next, { history: 'replace' });
  };
  const setIncludeEmpty = (next: boolean) => {
    void setEmptyParam(next ? true : null, { history: 'replace' });
  };
  const setColumns = (next: CashLedgerTableColumnSet) => {
    setStoredCols(next);
    try {
      window.localStorage.setItem(COLS_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the URL still carries the choice */
    }
    void setColsParam(next, { history: 'replace' });
  };

  return {
    vanId,
    range,
    group,
    autoGroup,
    groupIsAuto: groupParam === null,
    setGroup,
    includeEmpty: emptyParam,
    setIncludeEmpty,
    columns,
    setColumns,
  };
}

/** `GET /van-cash-ledger/daily-summary` for the current van + date window + table state. */
export function useCashLedgerDailySummary() {
  const state = useCashLedgerTableState();

  // `includeEmpty` is sent ONLY when true — never a literal `false` query string.
  const params: CashLedgerDailySummaryQuery = {
    vanId: state.vanId || undefined,
    from: state.range.from,
    to: state.range.to,
    group: state.group,
    includeEmpty: state.includeEmpty ? true : undefined,
  };

  return {
    ...useQuery({
      queryKey: [QUERY_KEY, 'daily-summary', params],
      queryFn: () => vanCashLedgerApi.getDailySummary(params).then((r) => r.data),
      placeholderData: keepPreviousData,
    }),
    ...state,
  };
}

/** Rows the day drawer lists (one page — "see all in timeline" covers the rest). */
export const PERIOD_ENTRIES_LIMIT = 100;

/** The ledger entries dated inside one table bucket — lazy, only while the drawer is open. */
export function useCashLedgerPeriodEntries(row: CashLedgerPeriodRow | null, enabled: boolean) {
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const params: CashLedgerTimelineQuery = {
    from: row?.from,
    to: row?.to,
    vanId: vanId || undefined,
    limit: PERIOD_ENTRIES_LIMIT,
  };

  return useQuery({
    queryKey: [QUERY_KEY, 'period-entries', params],
    queryFn: () => vanCashLedgerApi.getTimeline(params).then((r) => r.data),
    enabled: enabled && !!row,
  });
}

/** All cash that left the till: expenses + owner transfer + fuel-card top-ups. */
export const periodOutflow = (r: { totalExpenses: number; ownerTransfer: number; fuelCard: number }): number =>
  r.totalExpenses + r.ownerTransfer + r.fuelCard;

/** Adapts a table bucket to the shape the reusable P1 `DayStatement` renders (`date` is unused by it). */
export const toDayStatement = (row: CashLedgerPeriodRow): CashLedgerDayStatement => ({ ...row, date: row.from });
