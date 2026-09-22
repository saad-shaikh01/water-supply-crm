'use client';

import { cn } from '@water-supply-crm/ui';
import { EXPENSE_CENTER_SOURCE_BUCKETS, sourceBucketMeta } from '../constants';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';

const CHIP_BASE =
  'transition-colors inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 min-h-11 sm:min-h-8 text-xs font-bold whitespace-nowrap';

/**
 * "Recorded via" quick filter: All | Daily Sheet | Cash Ledger | Fleet |
 * Payroll | Direct Expense. Single-select (the backend `source` param takes
 * one bucket) — this is the admin-facing answer to "how much of our spend
 * came in through the Daily Sheet vs. the Cash Ledger vs. everywhere else?".
 * Changes are written to the URL immediately, same as the cash ledger's flow
 * chips this mirrors.
 */
export function ExpenseSourceChips() {
  const { source, setSource } = useExpenseCenterTimeline();
  const allActive = !source;

  return (
    <div
      role="group"
      aria-label="Filter by recording source"
      className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1"
    >
      <button
        type="button"
        aria-pressed={allActive}
        onClick={() => setSource(null)}
        className={cn(
          CHIP_BASE,
          allActive
            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
            : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/50',
        )}
      >
        All Sources
      </button>

      {EXPENSE_CENTER_SOURCE_BUCKETS.map((bucket) => {
        const meta = sourceBucketMeta(bucket);
        const active = source === bucket;
        return (
          <button
            key={bucket}
            type="button"
            aria-pressed={active}
            onClick={() => setSource(active ? null : bucket)}
            className={cn(
              CHIP_BASE,
              active
                ? cn(meta.color, 'ring-1 ring-current border-current')
                : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <span aria-hidden className={cn('h-2 w-2 rounded-full shrink-0', meta.solid)} />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
