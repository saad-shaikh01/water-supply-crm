'use client';

import { BookmarkCheck, ChevronDown, FilterX } from 'lucide-react';
import { useQueryState, parseAsString } from 'nuqs';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import {
  rangeLast3Months,
  rangeThisMonth,
  rangeThisWeek,
  rangeToday,
  type YmdRange,
} from '../../../lib/date-pkt';
import type { CashLedgerTimelineFilters } from '../api/van-cash-ledger.api';
import { useCashLedgerFilters } from '../hooks/use-cash-ledger-filters';
import { useCashLedgerView } from '../hooks/use-cash-ledger-view';

interface BuiltInView {
  key: string;
  label: string;
  hint: string;
  range: () => YmdRange;
  filters: CashLedgerTimelineFilters;
}

/**
 * Built-in views. Each one REPLACES the entry-filter set (everything is cleared
 * first) and sets the date range. "Pending approvals" looks back 3 months because
 * a pending item is dated when its sheet closed, which can be well before today.
 */
const BUILT_IN_VIEWS: readonly BuiltInView[] = [
  { key: 'today', label: 'Today’s entries', hint: 'Today', range: rangeToday, filters: {} },
  { key: 'late-week', label: 'Late entries this week', hint: 'This week · backdated', range: rangeThisWeek, filters: { backdatedOnly: true } },
  { key: 'pending', label: 'Pending approvals', hint: 'Last 3 months · pending', range: rangeLast3Months, filters: { status: ['PENDING'] } },
  { key: 'crew', label: 'Crew Cash this month', hint: 'This month · crew cash', range: rangeThisMonth, filters: { buckets: ['CREW_CASH'] } },
  { key: 'office-in', label: 'Office Cash In', hint: 'This month · office cash in', range: rangeThisMonth, filters: { buckets: ['OFFICE_CASH_IN'] } },
];

interface Props {
  /** Table view: entry filters do not apply, so the menu is inert. */
  disabled?: boolean;
}

/** "Views ▾" — one-click filter presets plus "Clear filters". */
export function CashLedgerViewsMenu({ disabled }: Props) {
  const { replaceFilters, clearFilters, anyActive } = useCashLedgerFilters();
  const [, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [view, setView] = useCashLedgerView();

  const apply = (preset: BuiltInView) => {
    const range = preset.range();
    replaceFilters(preset.filters);
    void setFrom(range.from);
    void setTo(range.to);
    if (view !== 'timeline') setView('timeline');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-11 sm:h-10 gap-1.5 rounded-xl px-3 font-semibold shrink-0"
          aria-label="Saved views"
        >
          <BookmarkCheck className="h-4 w-4" aria-hidden />
          Views
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl border-border/50 p-1.5 shadow-2xl">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Views
        </DropdownMenuLabel>
        {BUILT_IN_VIEWS.map((preset) => (
          <DropdownMenuItem
            key={preset.key}
            onSelect={() => apply(preset)}
            className="flex-col items-start gap-0 rounded-lg py-2 min-h-11 cursor-pointer"
          >
            <span className="text-sm font-semibold">{preset.label}</span>
            <span className="text-[11px] text-muted-foreground">{preset.hint}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={clearFilters}
          disabled={!anyActive}
          className="gap-2 rounded-lg min-h-11 cursor-pointer text-sm font-semibold"
        >
          <FilterX className="h-4 w-4" aria-hidden />
          Clear filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
