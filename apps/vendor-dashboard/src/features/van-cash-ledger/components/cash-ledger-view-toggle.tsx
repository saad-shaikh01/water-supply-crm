'use client';

import { List, Table2 } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useCashLedgerView, type CashLedgerView } from '../hooks/use-cash-ledger-view';

const OPTIONS: ReadonlyArray<{ value: CashLedgerView; label: string; icon: typeof List }> = [
  { value: 'timeline', label: 'Timeline', icon: List },
  { value: 'table', label: 'Table', icon: Table2 },
];

/**
 * Segmented Timeline | Table control (spec §4.5). State comes from
 * `useCashLedgerView` (URL + remembered per browser), so any component can read
 * the current view with that same hook.
 */
export function CashLedgerViewToggle({ className }: { className?: string }) {
  const [view, setView] = useCashLedgerView();

  return (
    <div
      role="radiogroup"
      aria-label="Ledger view"
      className={cn('inline-flex shrink-0 rounded-xl border border-border/50 bg-background/50 p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setView(value)}
            className={cn(
              'transition-colors flex min-h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs font-bold',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
