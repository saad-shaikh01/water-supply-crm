'use client';

import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Lock } from 'lucide-react';
import { Skeleton, cn } from '@water-supply-crm/ui';
import { useCashLedgerPeriods } from '../hooks/use-cash-ledger-periods';
import { resolveCashLedgerRange } from '../hooks/use-van-cash-ledger';
import { CashLedgerPeriodPanel } from './cash-ledger-period-panel';
import { PeriodDriftDot, hasDrift } from './period-drift-chip';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM" when the range has both bounds and both fall in the same PKT calendar month, else null. */
export function singleMonthLabel(range: { from?: string; to?: string }): string | null {
  const { from, to } = range;
  if (!from || !to || !YMD.test(from) || !YMD.test(to)) return null;
  return from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
}

/**
 * Which accounting period the ledger is currently looking at.
 *  - `viewed`: the period the URL range lies entirely within (null for multi-month / open-ended ranges,
 *    or a month the periods list doesn't carry) — drives the closed-period banner.
 *  - `period`: `viewed`, else the current month — drives the header pill.
 */
export function useViewedPeriod() {
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const query = useCashLedgerPeriods();
  const range = resolveCashLedgerRange(from, to);
  const label = singleMonthLabel(range);
  const data = query.data;

  const viewed = (label && data?.periods.find((p) => p.label === label)) || null;
  const current = (data && data.periods.find((p) => p.label === data.currentLabel)) || null;

  return { ...query, range, viewed, current, period: viewed ?? current };
}

/** Header pill: `Sep 2026 ● Open` / `Aug 2026 🔒 Closed` (+ amber dot when a closed period has drifted). Opens the periods panel. */
export function CashLedgerPeriodPill() {
  const { period, data, isLoading } = useViewedPeriod();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-11 sm:h-10 w-28 shrink-0 rounded-full" aria-hidden />;
  }
  // A failed periods request must never break the header — the pill simply doesn't render.
  if (!data || !period) return null;

  const closed = period.status === 'CLOSED';
  const drifted = closed && hasDrift(period);
  const statusText = closed ? 'closed' : 'open';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Accounting period ${period.displayLabel}, ${statusText}${drifted ? ', changed since it was closed' : ''}. Open period details`}
        title={drifted ? 'Entries were changed in this closed period after it was closed' : 'Accounting period details'}
        className={cn(
          'relative inline-flex h-11 sm:h-10 shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-3 text-xs font-bold',
          'hover:border-primary/40 hover:text-foreground transition-colors',
        )}
      >
        <span className="whitespace-nowrap">{period.displayLabel}</span>
        {closed ? (
          <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        )}
        <span className="font-semibold text-muted-foreground">{closed ? 'Closed' : 'Open'}</span>
        {drifted && <PeriodDriftDot />}
      </button>

      <CashLedgerPeriodPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
