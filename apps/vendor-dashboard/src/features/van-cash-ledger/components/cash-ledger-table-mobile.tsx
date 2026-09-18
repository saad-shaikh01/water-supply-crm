'use client';

import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, TrendingDown } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { CashLedgerDailySummary, CashLedgerPeriodRow } from '../api/van-cash-ledger.api';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { moneyOrDash } from '../format';
import { periodOutflow, toDayStatement } from '../hooks/use-cash-ledger-daily-summary';
import { DayStatement } from './day-statement';
import { PeriodMarkers } from './cash-ledger-table-controls';
import { balanceText, balanceTone } from './timeline-format';

export type TableSortDir = 'asc' | 'desc';

interface CashLedgerTableMobileProps {
  rows: CashLedgerPeriodRow[];
  totals: CashLedgerDailySummary['totals'];
  group: CashLedgerDailySummary['group'];
  sortDir: TableSortDir;
  onToggleSort: () => void;
  onOpenRow: (row: CashLedgerPeriodRow) => void;
  refreshing?: boolean;
}

/** A labelled figure inside the card header button (spans only — a button may contain phrasing content only). */
function Key({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-sm font-bold tabular-nums">{children}</span>
    </span>
  );
}

function ClosingFigure({ value }: { value: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1', balanceTone(value))}>
      {value < 0 && <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {balanceText(value)}
    </span>
  );
}

function PeriodCard({
  row, group, onOpen,
}: { row: CashLedgerPeriodRow; group: CashLedgerDailySummary['group']; onOpen: (row: CashLedgerPeriodRow) => void }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const out = periodOutflow(row);
  const negative = row.closing < 0;

  return (
    <li
      className={cn(
        'overflow-hidden rounded-2xl border bg-card/50',
        negative ? 'border-destructive/40 bg-destructive/5' : 'border-border/40',
        row.isEmpty && 'text-muted-foreground',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(row)}
        aria-label={`Open details for ${row.label}`}
        className="transition-colors flex min-h-11 w-full flex-col gap-2.5 p-3 text-left hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-black">{row.label}</span>
          <PeriodMarkers
            lateCount={row.lateCount}
            pendingCount={row.pendingCount}
            negativeClosing={negative}
            unit={group}
          />
        </span>
        <span className="grid grid-cols-3 gap-3">
          <Key label="In">
            <span className={cn(row.totalCashIn > 0 && CASH_LEDGER_BUCKET_META.SHEET_CASH_IN.text)}>
              {moneyOrDash(row.totalCashIn)}
            </span>
          </Key>
          <Key label="Out" title="Expenses + owner transfer + fuel card">
            <span className={cn(out > 0 && 'text-destructive')}>
              {out > 0 ? `− ${moneyOrDash(out)}` : '—'}
            </span>
          </Key>
          <Key label="Closing">
            <ClosingFigure value={row.closing} />
          </Key>
        </span>
      </button>

      <div className="border-t border-border/30">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
          className="transition-colors flex min-h-11 w-full items-center justify-between gap-2 px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          How this adds up
          {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        </button>
        {expanded && (
          <div id={panelId} className="px-3 pb-3">
            <DayStatement statement={toDayStatement(row)} />
          </div>
        )}
      </div>
    </li>
  );
}

/** Below `md`: one card per bucket, no horizontal scroll. */
export function CashLedgerTableMobile({
  rows, totals, group, sortDir, onToggleSort, onOpenRow, refreshing,
}: CashLedgerTableMobileProps) {
  const totalOut = periodOutflow(totals);
  const SortIcon = sortDir === 'desc' ? ArrowDown : ArrowUp;

  return (
    <div className={cn('space-y-2', refreshing && 'opacity-60')} aria-busy={refreshing}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Tap a card to see its entries.</p>
        <button
          type="button"
          onClick={onToggleSort}
          className="transition-colors inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SortIcon className="h-3.5 w-3.5" aria-hidden />
          {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      <ul className="space-y-2" aria-label="Cash ledger by period">
        {rows.map((row) => (
          <PeriodCard key={row.key} row={row} group={group} onOpen={onOpenRow} />
        ))}
      </ul>

      <section
        aria-label="Period total"
        className="space-y-2 rounded-2xl border border-border/60 bg-card/70 p-3"
      >
        <p className="flex items-center justify-between gap-2 text-sm font-black">
          Period total
          <PeriodMarkers lateCount={totals.lateCount} pendingCount={totals.pendingCount} unit={group} />
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Key label="In">{moneyOrDash(totals.totalCashIn)}</Key>
          <Key label="Out" title="Expenses + owner transfer + fuel card">
            {totalOut > 0 ? `− ${moneyOrDash(totalOut)}` : '—'}
          </Key>
          <Key label="Closing">
            <ClosingFigure value={totals.expectedClosing} />
          </Key>
        </div>
      </section>
    </div>
  );
}
