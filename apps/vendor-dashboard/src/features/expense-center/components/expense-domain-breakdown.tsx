'use client';

import { Skeleton, cn } from '@water-supply-crm/ui';
import { useExpenseCenterSummary } from '../hooks/use-expense-center';
import { domainMeta } from '../constants';

export function ExpenseDomainBreakdown() {
  const { data: summary, isLoading } = useExpenseCenterSummary();

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />;
  if (!summary) return null;

  // A zero-amount domain contributes nothing but noise — it would render a
  // 0px-wide bar segment and a "0%" legend row nobody can act on.
  const slices = (summary.byDomain ?? []).filter((s) => Number(s.amount) > 0);

  if (slices.length === 0) {
    return (
      <div className="rounded-2xl bg-card/30 border border-border/40 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Spend by Domain</p>
        <p className="text-xs text-muted-foreground mt-2">No spend recorded for this period.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card/30 border border-border/40 p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Spend by Domain</p>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {slices.map((slice) => {
          const meta = domainMeta(slice.domain);
          return (
            <div
              key={slice.domain}
              className={cn('h-full', meta.solid)}
              style={{ width: `${Math.max(0, Math.min(100, Number(slice.percent ?? 0)))}%` }}
              title={`${meta.label} — ${Number(slice.percent ?? 0).toFixed(1)}%`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {slices.map((slice) => {
          const meta = domainMeta(slice.domain);
          return (
            <div key={slice.domain} className="flex items-center gap-2 min-w-0">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', meta.solid)} />
              <span className="text-xs font-bold truncate">{meta.label}</span>
              <span className="text-[11px] font-mono font-black text-muted-foreground">
                {Number(slice.percent ?? 0).toFixed(1)}%
              </span>
              <span className="text-[11px] font-mono text-muted-foreground/70">
                ₨ {Number(slice.amount ?? 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
