'use client';

import { useEffect, useState, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useCashLedgerSummary } from '../hooks/use-van-cash-ledger';
import { useCashLedgerView } from '../hooks/use-cash-ledger-view';
import { useCashLedgerFilters } from '../hooks/use-cash-ledger-filters';
import { CASH_LEDGER_DATE_PRESETS, CASH_LEDGER_DEFAULT_PRESET } from '../constants';
import { CashLedgerViewToggle } from './cash-ledger-view-toggle';
import { CashLedgerSearch } from './cash-ledger-search';
import { CashLedgerFilterDrawer } from './cash-ledger-filter-drawer';
import { CashLedgerViewsMenu } from './cash-ledger-views-menu';
import { CashLedgerFlowChips } from './cash-ledger-flow-chips';
import { CashLedgerFilterChips } from './cash-ledger-filter-chips';

/** Root of every Cash Ledger react-query key (see hooks/use-van-cash-ledger.ts). */
const CASH_LEDGER_QUERY_KEY = 'van-cash-ledger';

/** "just now" / "42s ago" / "5m ago" / "3h ago". */
function relativeTime(updatedAt: number, now: number): string {
  const secs = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

interface Props {
  /**
   * Ref to the sticky wrapper. The page measures its height (ResizeObserver) and
   * publishes it as `--cl-sticky-top`, which the timeline's sticky day headers
   * use as their `top` offset — so this wrapper must stay the ONE sticky element.
   */
  ref?: Ref<HTMLDivElement>;
}

/**
 * The Cash Ledger's single sticky control bar:
 *   row 1  view toggle · date range · van · search · Filters · Views · Updated/Refresh
 *   row 2  flow chips (All | Sheet In | Office In | Expenses | Crew Cash | Payroll | Transfers)
 *   row 3  removable filter chips + filtered subtotal (only when a filter is active)
 * In Table view the entry-filter controls are disabled (the daily table only
 * honours date + van), with an inline hint and a way back to the Timeline.
 */
export function CashLedgerToolbar({ ref }: Props) {
  const queryClient = useQueryClient();
  const { dataUpdatedAt, isFetching } = useCashLedgerSummary();
  const [view, setView] = useCashLedgerView();
  const { anyActive } = useCashLedgerFilters();
  const tableView = view === 'table';

  // "Updated … ago" ticks without refetching.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Invalidating the root key refetches the active summary + timeline / daily table (and the pending queues).
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [CASH_LEDGER_QUERY_KEY] }); };

  return (
    <div
      ref={ref}
      className="sticky top-0 z-30 space-y-2.5 rounded-2xl border border-border bg-background/80 p-3 backdrop-blur-xl sm:p-4"
    >
      {/* Row 1 */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <CashLedgerViewToggle />

        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <DateRangePicker
            className="h-11 sm:h-10 w-full sm:w-auto sm:min-w-64"
            presets={CASH_LEDGER_DATE_PRESETS}
            defaultPreset={CASH_LEDGER_DEFAULT_PRESET}
          />
        </div>

        {/* Below sm the van select moves into the Filters drawer. */}
        <div className="hidden sm:block [&_button]:h-10">
          <VanFilter />
        </div>

        <CashLedgerSearch disabled={tableView} />
        <CashLedgerFilterDrawer disabled={tableView} />
        <CashLedgerViewsMenu disabled={tableView} />

        <div className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground">
          <span aria-live="polite" className="hidden min-[480px]:inline">
            {dataUpdatedAt ? `Updated ${relativeTime(dataUpdatedAt, now)}` : 'Not loaded yet'}
          </span>
          <span aria-hidden className="hidden min-[480px]:inline">·</span>
          <button
            type="button"
            onClick={refresh}
            disabled={isFetching}
            aria-label="Refresh cash ledger"
            className="transition-colors inline-flex h-11 sm:h-8 items-center gap-1.5 rounded-lg px-2 font-bold text-foreground hover:bg-accent/50 disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Row 2 */}
      <CashLedgerFlowChips disabled={tableView} />

      {/* Row 3 */}
      {tableView ? (
        <p role="note" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>Entry filters apply in Timeline view — the table always shows full daily statements.</span>
          <button
            type="button"
            onClick={() => setView('timeline')}
            className="transition-colors inline-flex min-h-9 items-center font-bold text-primary hover:underline underline-offset-2"
          >
            Switch to Timeline
          </button>
        </p>
      ) : (
        anyActive && <CashLedgerFilterChips hideKeys={['buckets']} showSubtotal />
      )}
    </div>
  );
}
