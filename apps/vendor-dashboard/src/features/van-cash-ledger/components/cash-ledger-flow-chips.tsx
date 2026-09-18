'use client';

import { cn } from '@water-supply-crm/ui';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import type { CashLedgerBucket } from '../api/van-cash-ledger.api';
import { CASH_LEDGER_FLOW_GROUPS, useCashLedgerFilters } from '../hooks/use-cash-ledger-filters';

interface Props {
  /** Table view: entry filters do not apply, so the chips are inert. */
  disabled?: boolean;
  className?: string;
}

const CHIP_BASE =
  'transition-colors inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 min-h-11 sm:min-h-8 text-xs font-bold whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none';

/**
 * Row 2 of the toolbar: multi-select "flow" chips over `filters.buckets`
 * (All | Sheet In | Office In | Expenses | Crew Cash | Payroll | Transfers).
 * Colours follow CASH_LEDGER_BUCKET_META — costs and cash-in are filled tints,
 * Transfers (owner transfer + fuel card, not costs) are outlined. Changes are
 * written to the URL immediately. Scrolls horizontally on narrow screens.
 */
export function CashLedgerFlowChips({ disabled, className }: Props) {
  const { filters, setFilters } = useCashLedgerFilters();
  const selected = new Set<CashLedgerBucket>(filters.buckets ?? []);

  const isActive = (buckets: readonly CashLedgerBucket[]) => buckets.every((b) => selected.has(b));

  const toggle = (buckets: readonly CashLedgerBucket[]) => {
    const next = new Set(selected);
    if (isActive(buckets)) buckets.forEach((b) => next.delete(b));
    else buckets.forEach((b) => next.add(b));
    setFilters({ buckets: next.size ? Array.from(next) : undefined });
  };

  const allActive = selected.size === 0;

  return (
    <div
      role="group"
      aria-label="Filter by cash flow"
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1',
        disabled && 'opacity-60',
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={allActive}
        onClick={() => setFilters({ buckets: undefined })}
        className={cn(
          CHIP_BASE,
          allActive
            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
            : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/50',
        )}
      >
        All
      </button>

      {CASH_LEDGER_FLOW_GROUPS.map((group) => {
        const meta = CASH_LEDGER_BUCKET_META[group.buckets[0]];
        const active = isActive(group.buckets);
        return (
          <button
            key={group.key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(group.buckets)}
            title={group.buckets.map((b) => CASH_LEDGER_BUCKET_META[b].label).join(' + ')}
            className={cn(
              CHIP_BASE,
              active
                ? cn(meta.chip, 'ring-1 ring-current', meta.isTransfer && 'border-current')
                : 'border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-2 w-2 rounded-full shrink-0',
                // Transfers are not costs: hollow dot (outlined) in both states.
                meta.isTransfer ? cn('border', active ? 'border-current' : 'border-muted-foreground/60') : meta.dot,
              )}
            />
            {group.label}
          </button>
        );
      })}
    </div>
  );
}
