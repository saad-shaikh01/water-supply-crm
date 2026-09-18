'use client';

import { X } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useCashLedgerFilters } from '../hooks/use-cash-ledger-filters';
import { useInfiniteCashLedgerTimeline } from '../hooks/use-van-cash-ledger';
import { money } from '../format';

/**
 * "Filtered: N entries · + ₨ in · − ₨ out" — the subtotal of the FILTERED rows,
 * straight from the timeline's `meta.filtered`. Reads the same react-query entry
 * the timeline renders from (deduped), so it costs no extra request. Only mount
 * it while the Timeline view is showing (it subscribes to the timeline query).
 */
function FilteredSubtotal() {
  const { data } = useInfiniteCashLedgerTimeline();
  const filtered = data?.pages[0]?.meta?.filtered;
  if (!filtered?.active) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 min-h-9 sm:min-h-7 text-[11px] font-bold text-primary whitespace-nowrap"
      aria-live="polite"
    >
      Filtered: {filtered.count.toLocaleString('en-PK')} {filtered.count === 1 ? 'entry' : 'entries'}
      <span aria-hidden>·</span>
      <span>+ {money(filtered.totalIn)}</span>
      <span aria-hidden>·</span>
      <span>− {money(filtered.totalOut)}</span>
    </span>
  );
}

interface Props {
  /** Chip keys not to render (the toolbar hides `buckets` — the flow chips above already show it). */
  hideKeys?: string[];
  /** Show the filtered-subtotal chip (needs the timeline query — Timeline view only). */
  showSubtotal?: boolean;
  /** Show the trailing "Clear all" action. */
  showClearAll?: boolean;
  /** One horizontally-scrolling line below `sm`, wrapping from `sm` up. */
  className?: string;
}

/**
 * Removable chips, one per active entry filter, with readable labels. Renders
 * nothing when there is nothing to show — so the toolbar's row 3 collapses.
 */
export function CashLedgerFilterChips({ hideKeys = [], showSubtotal = false, showClearAll = true, className }: Props) {
  const { chips, clearFilters } = useCashLedgerFilters();
  const visible = chips.filter((c) => !hideKeys.includes(c.key));

  return (
    <div
      className={cn('flex items-center gap-1.5 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      role="group"
      aria-label="Active filters"
    >
      {visible.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-card/60 pl-3 pr-1 min-h-9 sm:min-h-7 text-[11px] font-semibold text-foreground"
        >
          <span className="max-w-[16rem] truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="transition-colors inline-flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}

      {showClearAll && chips.length > 0 && (
        <button
          type="button"
          onClick={clearFilters}
          className="transition-colors shrink-0 rounded-full px-3 min-h-9 sm:min-h-7 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          Clear all
        </button>
      )}

      {showSubtotal && <FilteredSubtotal />}
    </div>
  );
}
