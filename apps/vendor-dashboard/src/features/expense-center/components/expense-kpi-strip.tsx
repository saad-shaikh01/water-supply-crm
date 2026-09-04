'use client';

import { Banknote, CreditCard, Layers, Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, Skeleton, cn } from '@water-supply-crm/ui';
import { useExpenseCenterSummary } from '../hooks/use-expense-center';

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

interface TileProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  children: React.ReactNode;
}

function Tile({ label, icon: Icon, iconClass, children }: TileProps) {
  return (
    <Card className="bg-card/30 border-border/40 rounded-2xl">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center shrink-0', iconClass ?? 'bg-muted text-muted-foreground')}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function ExpenseKpiStrip() {
  const { data: summary, isLoading } = useExpenseCenterSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const cashPercent = Math.max(0, Math.min(100, Number(summary.cashPercent ?? 0)));
  const cardPercent = Math.max(0, Math.min(100, Number(summary.cardPercent ?? 0)));
  const delta = summary.momDeltaPercent;
  const hasDelta = delta !== null && delta !== undefined;
  const spendRose = hasDelta && delta > 0;
  const spendFlat = hasDelta && delta === 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Total spend — a cost figure, so it carries the same critical tone as
          every other expense number in the app (see sheet-expenses-section). */}
      <Tile label="Total Spend" icon={Receipt} iconClass="bg-destructive/10 text-destructive">
        <p className="font-mono font-black text-xl text-destructive">{money(summary.totalSpend)}</p>
      </Tile>

      {/* Cash vs Card — teal = cash, blue = card, matching the vocabulary
          already established on the Daily Sheet screens. */}
      <Tile label="Cash vs Card" icon={Banknote} iconClass="bg-teal-500/10 text-teal-500">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="bg-teal-500 h-full" style={{ width: `${cashPercent}%` }} />
          <div className="bg-blue-500 h-full" style={{ width: `${cardPercent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 rounded-full bg-teal-500 shrink-0" />
            <span className="font-bold text-teal-500 font-mono">{cashPercent.toFixed(0)}%</span>
            <span className="text-muted-foreground truncate">{money(summary.cashAmount)}</span>
          </span>
          <span className="flex items-center gap-1.5 min-w-0">
            <CreditCard className="h-3 w-3 text-blue-500 shrink-0" />
            <span className="font-bold text-blue-500 font-mono">{cardPercent.toFixed(0)}%</span>
            <span className="text-muted-foreground truncate">{money(summary.cardAmount)}</span>
          </span>
        </div>
      </Tile>

      <Tile label="Top Category" icon={Layers} iconClass="bg-primary/10 text-primary">
        {summary.topCategory ? (
          <>
            <p className="text-sm font-bold truncate">{summary.topCategory.label}</p>
            <p className="font-mono font-black text-lg text-destructive">{money(summary.topCategory.amount)}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No spend in this period</p>
        )}
      </Tile>

      {/* Month-over-month. More spend is flagged critical; less spend is left
          deliberately neutral — a drop in cost is not automatically "good"
          (it can just as easily mean a missed month), so nothing here is green. */}
      <Tile label="vs Previous Month" icon={hasDelta && !spendRose ? TrendingDown : TrendingUp} iconClass={spendRose ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}>
        {hasDelta ? (
          <>
            <p className={cn('font-mono font-black text-xl flex items-center gap-1.5', spendRose ? 'text-destructive' : 'text-muted-foreground')}>
              <span aria-hidden>{spendFlat ? '▬' : spendRose ? '▲' : '▼'}</span>
              {Math.abs(delta).toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground">
              {spendFlat ? 'Flat vs last month' : spendRose ? 'More spend than last month' : 'Less spend than last month'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No comparable period</p>
        )}
      </Tile>
    </div>
  );
}
