'use client';

import type { ReactNode } from 'react';
import { Clock, TrendingDown } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { CashLedgerSummaryGroup } from '../api/van-cash-ledger.api';
import {
  useCashLedgerTableState,
  type CashLedgerTableColumnSet,
} from '../hooks/use-cash-ledger-daily-summary';

const GROUP_OPTIONS: ReadonlyArray<{ value: CashLedgerSummaryGroup; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const COLUMN_OPTIONS: ReadonlyArray<{ value: CashLedgerTableColumnSet; label: string; title: string }> = [
  { value: 'reconciliation', label: 'Reconciliation', title: 'Every column of the daily cash equation' },
  { value: 'compact', label: 'Compact', title: 'Total in, total out, net and closing only' },
  { value: 'audit', label: 'Audit', title: 'Entry counts: recorded, late, edited, voided, pending' },
];

/** `day` → "day", used to word the marker titles for whichever bucket size is on screen. */
export type PeriodUnit = CashLedgerSummaryGroup;

/**
 * Row markers shared by the table's Date cell, the mobile cards and the legend:
 * clock + count = entries recorded after the bucket, amber dot = awaiting
 * approval, red trending-down = overdrawn (negative closing). Each has a text
 * alternative so nothing is colour-only.
 */
export function PeriodMarkers({
  lateCount, pendingCount, negativeClosing, unit = 'day',
}: {
  lateCount: number;
  pendingCount: number;
  negativeClosing?: boolean;
  unit?: PeriodUnit;
}) {
  if (lateCount <= 0 && pendingCount <= 0 && !negativeClosing) return null;
  const lateText = `${lateCount} ${lateCount === 1 ? 'entry' : 'entries'} recorded after this ${unit}`;
  const pendingText = `${pendingCount} awaiting approval`;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-sans">
      {lateCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-muted-foreground" title={lateText}>
          <Clock className="h-3 w-3" aria-hidden />
          <span aria-hidden>{lateCount}</span>
          <span className="sr-only">{lateText}</span>
        </span>
      )}
      {pendingCount > 0 && (
        <span className="inline-flex items-center" title={pendingText}>
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          <span className="sr-only">{pendingText}</span>
        </span>
      )}
      {negativeClosing && (
        <span className="inline-flex items-center text-destructive" title="Cash overdrawn — negative closing balance">
          <TrendingDown className="h-3 w-3" aria-hidden />
          <span className="sr-only">Cash overdrawn — negative closing balance</span>
        </span>
      )}
    </span>
  );
}

function Segmented<T extends string>({
  label, value, options, onChange, className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex shrink-0 rounded-xl border border-border/50 bg-background/50 p-0.5', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'transition-colors min-h-11 sm:min-h-9 rounded-[10px] px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function LegendItem({ children }: { children: ReactNode }) {
  return <li className="inline-flex items-center gap-1.5">{children}</li>;
}

/** Compact legend for the row markers and the "transfers are not expenses" colour rule. */
export function CashLedgerTableLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Table legend"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground', className)}
    >
      <LegendItem>
        <Clock className="h-3 w-3" aria-hidden /> Entries recorded after that day
      </LegendItem>
      <LegendItem>
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> Awaiting approval
      </LegendItem>
      <LegendItem>
        <TrendingDown className="h-3 w-3 text-destructive" aria-hidden /> Overdrawn (negative closing)
      </LegendItem>
      <LegendItem>
        <span className="rounded-md border border-violet-500/50 px-1 text-violet-500" aria-hidden>₨</span>
        Outlined = transfer, not an expense
      </LegendItem>
    </ul>
  );
}

/**
 * Table-view controls (spec §4.8): Day/Week/Month bucketing, the column set
 * (desktop only — mobile cards have a fixed layout), "Show empty days" and the
 * legend. All state is the URL-backed `useCashLedgerTableState`.
 */
export function CashLedgerTableControls({ showColumnSets = true }: { showColumnSets?: boolean }) {
  const {
    group, autoGroup, groupIsAuto, setGroup, includeEmpty, setIncludeEmpty, columns, setColumns,
  } = useCashLedgerTableState();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <Segmented
            label="Group rows by"
            value={group}
            options={GROUP_OPTIONS}
            onChange={setGroup}
          />
          {groupIsAuto && group === autoGroup && group !== 'day' && (
            <span className="text-[10px] font-semibold text-muted-foreground" title="Chosen automatically because the date range is long">
              Auto
            </span>
          )}
        </div>

        {showColumnSets && (
          <Segmented
            label="Column set"
            value={columns}
            options={COLUMN_OPTIONS}
            onChange={setColumns}
          />
        )}

        {/* Native checkbox styled as a switch — the UI kit has no Switch. */}
        <label className="inline-flex min-h-11 sm:min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={includeEmpty}
            onChange={(e) => setIncludeEmpty(e.target.checked)}
          />
          <span
            aria-hidden
            className={cn(
              'transition-colors relative h-5 w-9 shrink-0 rounded-full border border-border bg-muted',
              "after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-foreground after:content-['']",
              'peer-checked:border-primary peer-checked:bg-primary peer-checked:after:translate-x-4 peer-checked:after:bg-primary-foreground',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
            )}
          />
          Show empty days
        </label>
      </div>

      <CashLedgerTableLegend />
    </div>
  );
}
