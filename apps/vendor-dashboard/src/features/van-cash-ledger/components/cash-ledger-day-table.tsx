'use client';

import {
  useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode,
} from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { ArrowDown, ArrowUp, TrendingDown } from 'lucide-react';
import {
  TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, cn,
} from '@water-supply-crm/ui';
import type {
  CashLedgerBucket, CashLedgerDailySummary, CashLedgerPeriodRow, CashLedgerStatementTotals,
  CashLedgerSummaryGroup,
} from '../api/van-cash-ledger.api';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { moneyOrDash } from '../format';
import {
  periodOutflow, useCashLedgerDailySummary, type CashLedgerTableColumnSet,
} from '../hooks/use-cash-ledger-daily-summary';
import { rangeLastMonth } from '../../../lib/date-pkt';
import { CashLedgerDayDrawer } from './cash-ledger-day-drawer';
import { CashLedgerTableControls, PeriodMarkers } from './cash-ledger-table-controls';
import { CashLedgerTableMobile, type TableSortDir } from './cash-ledger-table-mobile';
import {
  CashLedgerTableEmpty, CashLedgerTableError, CashLedgerTableSkeleton, CashLedgerTruncatedNotice,
} from './cash-ledger-table-states';
import { balanceText, balanceTone } from './timeline-format';
import { InlineRetry } from './timeline-states';

// ── Responsive switch ────────────────────────────────────────────────────────

const DESKTOP_QUERY = '(min-width: 768px)';
const subscribeDesktop = (onChange: () => void) => {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
/** `md` and up. Server / hydration snapshot is desktop, so the first client paint matches the server HTML. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, getDesktop, () => true);
}

// ── Figures: one shape for a body row and the totals footer ──────────────────

/** Everything a cell renderer needs — a `CashLedgerPeriodRow` already fits; the footer builds one from `totals`. */
interface Figures extends CashLedgerStatementTotals {
  opening: number;
  closing: number;
  entryCount: number;
  lateCount: number;
  pendingCount: number;
  /** `null` = not knowable for the whole range (the server sends no range total for it and the rows were truncated). */
  recordedCount: number | null;
  editedCount: number | null;
  voidedCount: number | null;
}

function totalsAsFigures(
  totals: CashLedgerDailySummary['totals'], rows: CashLedgerPeriodRow[], truncated: boolean,
): Figures {
  // recorded / edited / voided have no range total in the contract — sum the rows, unless rows were dropped.
  const sum = (pick: (r: CashLedgerPeriodRow) => number) => (truncated ? null : rows.reduce((acc, r) => acc + pick(r), 0));
  return {
    ...totals,
    opening: totals.broughtForward,
    closing: totals.expectedClosing,
    recordedCount: sum((r) => r.recordedCount),
    editedCount: sum((r) => r.editedCount),
    voidedCount: sum((r) => r.voidedCount),
  };
}

// ── Cell atoms ───────────────────────────────────────────────────────────────

/** A zero-dashed money figure. `chip` outlines it (transfers are not costs, so they never use a filled tone). */
function Fig({ value, tone, strong, chip }: { value: number; tone?: string; strong?: boolean; chip?: string }) {
  if (!value) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className={cn(tone, strong && 'font-bold', chip && cn('inline-block rounded-md border px-1.5 py-0.5', chip))}>
      {moneyOrDash(value)}
    </span>
  );
}

/** Opening / Net / Closing: always a number; negative keeps its explicit "−", destructive tone and an icon. */
function BalanceFig({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span className={cn('inline-flex items-center justify-end gap-1', balanceTone(value), strong && 'font-bold')}>
      {value < 0 && <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />}
      {balanceText(value)}
    </span>
  );
}

function Count({ value, tone, title }: { value: number | null; tone?: string; title?: string }) {
  if (value === null) {
    return <span className="text-muted-foreground/40" title="Not available for a truncated range">—</span>;
  }
  if (!value) return <span className="text-muted-foreground/40">—</span>;
  return <span className={tone} title={title}>{value.toLocaleString('en-PK')}</span>;
}

// ── Column model ─────────────────────────────────────────────────────────────

type GroupId = 'in' | 'exp' | 'transfers' | 'position';

const GROUP_META: Record<GroupId, { label: string; head: string }> = {
  in: { label: 'Cash in', head: 'text-emerald-500 dark:text-emerald-500 border-b-emerald-500/50' },
  exp: { label: 'Expenses', head: 'text-destructive dark:text-destructive border-b-destructive/50' },
  // Transfers are outlined / dashed — a deliberate visual "not a cost" cue.
  transfers: { label: 'Transfers', head: 'text-violet-500 dark:text-violet-500 border-b-violet-500/50 border-dashed' },
  position: { label: 'Position', head: 'text-foreground dark:text-foreground border-b-border' },
};

interface ColumnDef {
  id: string;
  label: string;
  /** Full spoken name where the short label repeats ("Office" cash in vs "Office" expenses). */
  srLabel?: string;
  group?: GroupId;
  render: (f: Figures) => ReactNode;
}

const B = CASH_LEDGER_BUCKET_META;
const flow = (pick: (f: Figures) => number, bucket: CashLedgerBucket) => (f: Figures) => (
  <Fig value={pick(f)} tone={B[bucket].text} chip={B[bucket].isTransfer ? B[bucket].chip : undefined} />
);

const COL = {
  opening: { id: 'opening', label: 'Opening', render: (f) => <BalanceFig value={f.opening} /> },
  sheet: {
    id: 'sheet', label: 'Sheet', srLabel: 'Sheet cash in', group: 'in',
    render: flow((f) => f.sheetCashIn, 'SHEET_CASH_IN'),
  },
  office: {
    id: 'office', label: 'Office', srLabel: 'Office cash in', group: 'in',
    render: flow((f) => f.officeCashIn, 'OFFICE_CASH_IN'),
  },
  totalIn: {
    id: 'totalIn', label: 'Total', srLabel: 'Total cash in', group: 'in',
    render: (f) => <Fig value={f.totalCashIn} strong />,
  },
  officeExp: {
    id: 'officeExp', label: 'Office', srLabel: 'Office expenses', group: 'exp',
    render: flow((f) => f.officeExpenses, 'OFFICE_EXPENSE'),
  },
  payroll: {
    id: 'payroll', label: 'Payroll', srLabel: 'Payroll cash', group: 'exp',
    render: flow((f) => f.payrollCash, 'PAYROLL_CASH'),
  },
  crew: {
    id: 'crew', label: 'Crew', srLabel: 'Crew cash', group: 'exp',
    render: flow((f) => f.crewCash, 'CREW_CASH'),
  },
  totalExp: {
    id: 'totalExp', label: 'Total', srLabel: 'Total expenses', group: 'exp',
    render: (f) => <Fig value={f.totalExpenses} strong />,
  },
  owner: {
    id: 'owner', label: 'Owner', srLabel: 'Owner transfer', group: 'transfers',
    render: flow((f) => f.ownerTransfer, 'OWNER_TRANSFER'),
  },
  fuel: {
    id: 'fuel', label: 'Fuel card', srLabel: 'Fuel card top-ups', group: 'transfers',
    render: flow((f) => f.fuelCard, 'FUEL_CARD'),
  },
  net: { id: 'net', label: 'Net', group: 'position', render: (f) => <BalanceFig value={f.net} /> },
  closing: {
    id: 'closing', label: 'Closing', srLabel: 'Expected closing', group: 'position',
    render: (f) => <BalanceFig value={f.closing} strong />,
  },
  entries: { id: 'entries', label: 'Entries', render: (f) => <Count value={f.entryCount} /> },
} satisfies Record<string, ColumnDef>;

const COLUMN_SETS: Record<CashLedgerTableColumnSet, ColumnDef[]> = {
  reconciliation: [
    COL.opening, COL.sheet, COL.office, COL.totalIn, COL.officeExp, COL.payroll, COL.crew, COL.totalExp,
    COL.owner, COL.fuel, COL.net, COL.closing, COL.entries,
  ],
  compact: [
    { id: 'cTotalIn', label: 'Total In', render: (f) => <Fig value={f.totalCashIn} tone={B.SHEET_CASH_IN.text} strong /> },
    {
      id: 'cTotalOut', label: 'Total Out',
      render: (f) => <Fig value={periodOutflow(f)} tone="text-destructive" strong />,
    },
    { ...COL.net, group: undefined },
    { ...COL.closing, group: undefined },
  ],
  audit: [
    COL.entries,
    { id: 'recorded', label: 'Recorded that day', render: (f) => <Count value={f.recordedCount} /> },
    {
      id: 'late', label: 'Late',
      render: (f) => <Count value={f.lateCount} title="Dated here, recorded on a later day" />,
    },
    { id: 'edited', label: 'Edited', render: (f) => <Count value={f.editedCount} /> },
    { id: 'voided', label: 'Voided', render: (f) => <Count value={f.voidedCount} tone="text-destructive" /> },
    {
      id: 'pending', label: 'Pending',
      render: (f) => <Count value={f.pendingCount} tone="text-amber-500" title="Awaiting approval" />,
    },
  ],
};

/** Consecutive columns of the same group → one spanning header cell. */
function groupRuns(columns: ColumnDef[]): Array<{ group?: GroupId; columns: ColumnDef[] }> {
  const runs: Array<{ group?: GroupId; columns: ColumnDef[] }> = [];
  for (const col of columns) {
    const last = runs[runs.length - 1];
    if (col.group && last && last.group === col.group) last.columns.push(col);
    else runs.push({ group: col.group, columns: [col] });
  }
  return runs;
}

const startsGroup = (columns: ColumnDef[], i: number): boolean =>
  !!columns[i].group && columns[i - 1]?.group !== columns[i].group;

// ── Table ────────────────────────────────────────────────────────────────────

const HEAD_CELL =
  'h-auto whitespace-nowrap border-b border-border/50 bg-background px-2.5 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground';
const BODY_CELL =
  'whitespace-nowrap border-b border-border/30 px-2.5 py-2.5 text-right font-mono text-xs tabular-nums group-hover/row:text-foreground';
const GROUP_DIVIDER = 'border-l border-l-border/40';
/** Opaque so scrolled columns never show through; the gradient layers a translucent tint OVER the solid background. */
const STICKY_DATE_CELL =
  'sticky left-0 z-[5] border-r border-r-border/40 bg-background text-left font-sans';

const DATE_HEADER: Record<CashLedgerSummaryGroup, string> = { day: 'Date', week: 'Week', month: 'Month' };

interface DesktopTableProps {
  rows: CashLedgerPeriodRow[];
  totals: CashLedgerDailySummary['totals'];
  truncated: boolean;
  group: CashLedgerSummaryGroup;
  columnSet: CashLedgerTableColumnSet;
  sortDir: TableSortDir;
  onToggleSort: () => void;
  onOpenRow: (row: CashLedgerPeriodRow) => void;
  refreshing: boolean;
}

function CashLedgerTableDesktop({
  rows, totals, truncated, group, columnSet, sortDir, onToggleSort, onOpenRow, refreshing,
}: DesktopTableProps) {
  const columns = COLUMN_SETS[columnSet];
  const runs = useMemo(() => groupRuns(columns), [columns]);
  const hasGroups = runs.some((r) => r.group);
  const footer = useMemo(() => totalsAsFigures(totals, rows, truncated), [totals, rows, truncated]);
  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp;

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: CashLedgerPeriodRow) => {
    // Ignore keys bubbling up from a nested control; only the row itself acts as the button.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenRow(row);
    }
  };

  return (
    <div
      role="region"
      aria-label="Cash ledger table"
      aria-busy={refreshing}
      // A horizontal scroller makes this box the sticky containment for BOTH axes, so it also scrolls vertically:
      // capped to the viewport below the page's sticky toolbar (`--cl-sticky-top`, set on the page root).
      className={cn(
        'relative max-h-[calc(100dvh-var(--cl-sticky-top,0px)-1rem)] overflow-auto rounded-2xl border border-border/40 bg-card/20',
        refreshing && 'opacity-60',
      )}
    >
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Cash ledger reconciliation by {group}. Each row is one {group} with its opening cash, cash in, expenses,
          transfers and closing cash; press a row to open its statement and entries. The last row is the period total.
        </caption>

        <TableHeader className="border-b-0 bg-background backdrop-blur-none dark:bg-background">
          <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
            <TableHead
              scope="col"
              rowSpan={hasGroups ? 2 : 1}
              aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}
              className={cn(HEAD_CELL, 'sticky left-0 z-[1] border-r border-r-border/40 text-left align-bottom')}
            >
              <button
                type="button"
                onClick={onToggleSort}
                title={sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
                className="transition-colors inline-flex min-h-8 items-center gap-1 rounded-md text-[10px] font-bold uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {DATE_HEADER[group]}
                <SortIcon className="h-3 w-3" aria-hidden />
              </button>
            </TableHead>

            {runs.map((run, i) =>
              run.group ? (
                <TableHead
                  key={`${run.group}-${i}`}
                  scope="colgroup"
                  colSpan={run.columns.length}
                  className={cn(HEAD_CELL, 'border-b-2 text-center', GROUP_DIVIDER, GROUP_META[run.group].head)}
                >
                  {GROUP_META[run.group].label}
                </TableHead>
              ) : (
                run.columns.map((col) => (
                  <TableHead
                    key={col.id}
                    scope="col"
                    rowSpan={hasGroups ? 2 : 1}
                    className={cn(HEAD_CELL, 'align-bottom')}
                  >
                    {col.label}
                  </TableHead>
                ))
              ),
            )}
          </TableRow>

          {hasGroups && (
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              {columns.map((col, i) =>
                col.group ? (
                  <TableHead
                    key={col.id}
                    scope="col"
                    className={cn(HEAD_CELL, startsGroup(columns, i) && GROUP_DIVIDER)}
                  >
                    <span aria-hidden>{col.label}</span>
                    <span className="sr-only">{col.srLabel ?? col.label}</span>
                  </TableHead>
                ) : null,
              )}
            </TableRow>
          )}
        </TableHeader>

        <TableBody className="divide-y-0">
          {rows.map((row) => {
            const negative = row.closing < 0;
            return (
              <TableRow
                key={row.key}
                role="button"
                tabIndex={0}
                aria-label={`${row.label}. Closing ${balanceText(row.closing)}. ${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}. Open details.`}
                onClick={() => onOpenRow(row)}
                onKeyDown={(e) => onRowKey(e, row)}
                className={cn(
                  'cursor-pointer hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  negative && 'bg-destructive/5 hover:bg-destructive/10 dark:hover:bg-destructive/10',
                )}
              >
                <TableCell
                  className={cn(
                    BODY_CELL, STICKY_DATE_CELL, 'px-3',
                    negative
                      ? 'bg-gradient-to-r from-destructive/5 to-destructive/5 group-hover/row:from-destructive/10 group-hover/row:to-destructive/10'
                      : 'group-hover/row:bg-gradient-to-r group-hover/row:from-foreground/[0.04] group-hover/row:to-foreground/[0.04]',
                  )}
                >
                  <span className="flex min-w-[10rem] items-center gap-2">
                    <span className={cn('text-xs font-semibold', row.isEmpty && 'font-medium text-muted-foreground')}>
                      {row.label}
                    </span>
                    <PeriodMarkers
                      lateCount={row.lateCount}
                      pendingCount={row.pendingCount}
                      negativeClosing={negative}
                      unit={group}
                    />
                  </span>
                </TableCell>

                {columns.map((col, i) => (
                  <TableCell key={col.id} className={cn(BODY_CELL, startsGroup(columns, i) && GROUP_DIVIDER)}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>

        <TableFooter className="sticky bottom-0 z-10 border-t-0 bg-background dark:bg-background">
          <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
            <TableHead
              scope="row"
              className={cn(
                BODY_CELL, STICKY_DATE_CELL, 'h-auto border-t-2 border-t-border px-3 text-xs font-black normal-case tracking-normal text-foreground dark:text-foreground',
              )}
            >
              <span className="flex min-w-[10rem] items-center gap-2">
                Period total
                <PeriodMarkers
                  lateCount={totals.lateCount}
                  pendingCount={totals.pendingCount}
                  negativeClosing={totals.expectedClosing < 0}
                  unit={group}
                />
              </span>
            </TableHead>
            {columns.map((col, i) => (
              <TableCell
                key={col.id}
                className={cn(BODY_CELL, 'border-t-2 border-t-border bg-background font-bold', startsGroup(columns, i) && GROUP_DIVIDER)}
              >
                {col.render(footer)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </table>
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

/**
 * Table view of the Cash Ledger (spec §4.8): one row per day (or week / month),
 * the reconciliation equation across, a totals footer, and a drawer with the
 * bucket's statement + entries. Desktop (≥ md) renders the grouped-header table;
 * below md it renders cards. No props — everything is URL state
 * (`vanId`, `from`, `to`, `tgroup`, `tempty`, `tcols`).
 */
export function CashLedgerDayTable() {
  const {
    data, isLoading, isError, error, refetch, isFetching, isPlaceholderData,
    columns, includeEmpty, setIncludeEmpty, vanId,
  } = useCashLedgerDailySummary();
  const isDesktop = useIsDesktop();

  const [, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [, setTo] = useQueryState('to', parseAsString.withDefault(''));

  // Newest first, as the server returns it; the Date header flips it. Keys sort lexicographically in calendar order.
  const [sortDir, setSortDir] = useState<TableSortDir>('desc');
  const toggleSort = () => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    return [...list].sort((a, b) => (sortDir === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
  }, [data?.rows, sortDir]);

  // The drawer keeps its own snapshot so it can finish its exit animation after `open` flips false.
  const [drawer, setDrawer] = useState<{ row: CashLedgerPeriodRow; group: CashLedgerSummaryGroup; open: boolean } | null>(null);
  const openRow = (row: CashLedgerPeriodRow) => setDrawer({ row, group: data?.group ?? 'day', open: true });
  const setDrawerOpen = (open: boolean) => setDrawer((d) => (d ? { ...d, open } : d));
  // An approval / refresh while the drawer is open refetches the summary: keep its statement current.
  useEffect(() => {
    if (!drawer?.open || !data) return;
    const fresh = data.rows.find((r) => r.key === drawer.row.key);
    if (fresh && fresh !== drawer.row) setDrawer((d) => (d ? { ...d, row: fresh } : d));
  }, [data, drawer]);

  const refreshing = !isLoading && (isPlaceholderData || isFetching);

  let body: ReactNode;
  if (isLoading) {
    body = <CashLedgerTableSkeleton mobile={!isDesktop} />;
  } else if (isError && !data) {
    body = <CashLedgerTableError error={error} onRetry={() => void refetch()} retrying={isFetching} />;
  } else if (data && data.rows.length === 0) {
    body = (
      <CashLedgerTableEmpty
        includeEmpty={includeEmpty}
        hasVanFilter={!!vanId}
        onShowEmptyDays={() => setIncludeEmpty(true)}
        onShowLastMonth={() => {
          const r = rangeLastMonth();
          void setFrom(r.from);
          void setTo(r.to);
        }}
      />
    );
  } else if (data) {
    body = isDesktop ? (
      <CashLedgerTableDesktop
        rows={rows}
        totals={data.totals}
        truncated={data.truncated}
        group={data.group}
        columnSet={columns}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        onOpenRow={openRow}
        refreshing={refreshing}
      />
    ) : (
      <CashLedgerTableMobile
        rows={rows}
        totals={data.totals}
        group={data.group}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        onOpenRow={openRow}
        refreshing={refreshing}
      />
    );
  }

  return (
    // pb-28 keeps the page's floating mini-bar / "+" from covering the last row.
    <section aria-label="Cash ledger table view" className="space-y-3 pb-28">
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cash Ledger Table</h2>

      <CashLedgerTableControls showColumnSets={isDesktop} />

      {data?.truncated && <CashLedgerTruncatedNotice />}

      {isError && data && (
        <InlineRetry
          label="Couldn't refresh the table — showing the last loaded data."
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}

      {body}

      <CashLedgerDayDrawer
        row={drawer?.row ?? null}
        group={drawer?.group ?? data?.group ?? 'day'}
        open={!!drawer?.open}
        onOpenChange={setDrawerOpen}
      />
    </section>
  );
}
