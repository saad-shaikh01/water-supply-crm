'use client';

import { useExpenseCenterTimeline } from '../hooks/use-expense-center';
import { money } from '../../van-cash-ledger/format';

/**
 * Fixed bottom-left box with the subtotal of EVERY row matching the active
 * filters (all pages) — straight from the timeline's `meta.filtered`. Renders
 * nothing unless a filter is active. Reads the same react-query entry the
 * timeline uses, so it costs no extra request.
 */
export function ExpenseFilteredTotalsBox() {
  const { data } = useExpenseCenterTimeline();
  const filtered = data?.meta.filtered;
  if (!filtered?.active) return null;

  return (
    <div
      className="fixed bottom-4 left-4 md:left-[19rem] z-40 w-56 rounded-2xl border border-primary/30 bg-background/95 p-3 shadow-2xl backdrop-blur-xl"
      aria-live="polite"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Filtered · {filtered.count.toLocaleString('en-PK')} {filtered.count === 1 ? 'entry' : 'entries'}
      </p>
      <p className="mt-0.5 text-lg font-extrabold text-primary">{money(filtered.totalAmount)}</p>
      <div className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1.5 text-[11px] font-semibold">
        <div className="flex justify-between"><span className="text-muted-foreground">Cash</span><span>{money(filtered.cashAmount)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Card / Bank</span><span>{money(filtered.cardAmount)}</span></div>
      </div>
    </div>
  );
}
