'use client';

import { useState } from 'react';
import { AlertCircle, Banknote, Landmark, TrendingDown, Wallet } from 'lucide-react';
import { Badge, Skeleton, cn } from '@water-supply-crm/ui';
import { useCashLedgerStats } from '../hooks/use-van-cash-ledger';
import { PendingApprovalsPanel } from './pending-approvals-panel';

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

interface StatProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  valueClass?: string;
  value: string;
}

function Stat({ label, icon: Icon, iconClass, valueClass, value }: StatProps) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', iconClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
        <p className={cn('font-mono font-black text-sm tabular-nums truncate', valueClass)}>{value}</p>
      </div>
    </div>
  );
}

/**
 * Sticky bottom bar (mirrors the `sticky bottom-4 z-30` treatment Expense
 * Center's own timeline pagination and the shared `DataTable` footer use —
 * see `expense-timeline.tsx` / `data-table.tsx`).
 */
export function CashLedgerStatsBar() {
  const { data: stats, isLoading } = useCashLedgerStats();
  const [panelOpen, setPanelOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="sticky bottom-4 z-30">
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  if (!stats) return null;

  const pendingCount = stats.pendingHandoverCount ?? 0;
  const pendingRemittanceCount = stats.pendingRemittanceCount ?? 0;
  const available = stats.availableBalance ?? 0;
  const isNegative = available < 0;

  return (
    <>
      <div className="sticky bottom-4 z-30">
        <div className="mx-auto max-w-fit sm:max-w-none">
          <div className="bg-background/95 dark:bg-[#0a0a0f]/80 backdrop-blur-2xl border border-border rounded-2xl px-4 py-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Stat
                label="Total Expense"
                icon={TrendingDown}
                iconClass="bg-destructive/10 text-destructive"
                valueClass="text-destructive"
                value={money(stats.totalExpense)}
              />
              <Stat
                label="Total Cash In"
                icon={Banknote}
                iconClass="bg-emerald-500/10 text-emerald-500"
                valueClass="text-emerald-500"
                value={money(stats.totalCashIn)}
              />
              <Stat
                label="Handover to Owner"
                icon={Landmark}
                iconClass="bg-violet-500/10 text-violet-500"
                valueClass="text-violet-500"
                value={money(stats.totalRemitted)}
              />
              <Stat
                label="Available Balance"
                icon={Wallet}
                iconClass={isNegative ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}
                valueClass={isNegative ? 'text-destructive' : undefined}
                value={money(available)}
              />

              <div className="ml-auto flex items-center gap-2">
                {isNegative && (
                  <Badge className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border-none bg-destructive/10 text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Negative cash position
                  </Badge>
                )}
                {(pendingCount > 0 || pendingRemittanceCount > 0) && (
                  <button type="button" onClick={() => setPanelOpen(true)}>
                    <Badge className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border-none bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors cursor-pointer">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {pendingCount + pendingRemittanceCount} pending approval
                      {pendingCount + pendingRemittanceCount === 1 ? '' : 's'}
                    </Badge>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <PendingApprovalsPanel open={panelOpen} onOpenChange={setPanelOpen} />
    </>
  );
}
