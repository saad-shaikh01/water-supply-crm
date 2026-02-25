'use client';

import { useRouter } from 'next/navigation';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { Card, CardContent, Badge, Skeleton } from '@water-supply-crm/ui';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useDriverStats } from '../hooks/use-driver';

const PAGE_SIZE = 15;

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }
  return options;
}

function formatSheetDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function DriverHistory() {
  const router = useRouter();
  const monthOptions = buildMonthOptions();
  const [month, setMonth] = useQueryState(
    'month',
    parseAsString.withDefault(getCurrentMonth()),
  );
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const { data: stats, isLoading } = useDriverStats({ month });

  const allSheets = stats?.sheets ?? [];
  const totalPages = Math.max(1, Math.ceil(allSheets.length / PAGE_SIZE));
  const pagedSheets = allSheets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const failureEntries = Object.entries(stats?.failureBreakdown ?? {}).sort(
    ([, a], [, b]) => b - a,
  );
  const maxFailureCount = failureEntries[0]?.[1] ?? 1;

  function handleMonthChange(value: string) {
    setMonth(value);
    setPage(1);
  }

  const discrepancy = stats?.cashDiscrepancy ?? 0;

  function DiscrepancyBadge() {
    if (discrepancy === 0)
      return (
        <span className="text-xs font-semibold text-emerald-500">Balanced ✓</span>
      );
    if (discrepancy > 0)
      return (
        <Badge variant="destructive" className="text-xs">
          ₨{discrepancy.toLocaleString()} short
        </Badge>
      );
    return (
      <Badge className="text-xs bg-amber-500/20 text-amber-500 border-amber-500/30">
        ₨{Math.abs(discrepancy).toLocaleString()} over
      </Badge>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header + Month Selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">My History</h1>
        <select
          value={month}
          onChange={(e) => handleMonthChange(e.target.value)}
          className="px-3 py-2 rounded-xl bg-card/60 border border-white/10 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Monthly Stats */}
      <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl">
        <CardContent className="p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-4">
            Monthly Stats
          </p>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
              <StatRow label="Sheets" value={String(stats?.totalSheets ?? 0)} />
              <StatRow
                label="Deliveries"
                value={`${stats?.deliveredCount ?? 0} / ${stats?.totalItems ?? 0}`}
              />
              <StatRow
                label="Success Rate"
                value={`${stats?.successRate ?? 0}%`}
                accent={
                  stats && stats.successRate >= 90
                    ? 'green'
                    : stats && stats.successRate >= 70
                      ? 'amber'
                      : 'red'
                }
              />
              <StatRow
                label="Bottles Dropped"
                value={String(stats?.totalBottlesDropped ?? 0)}
              />
              <StatRow
                label="Empties Received"
                value={String(stats?.totalEmptiesReceived ?? 0)}
              />
              <div className="flex items-center justify-between col-span-2 border-t border-white/5 pt-2.5 mt-1">
                <div className="text-xs text-muted-foreground">
                  Expected:{' '}
                  <span className="text-foreground font-semibold">
                    ₨{(stats?.cashExpected ?? 0).toLocaleString()}
                  </span>
                  <span className="mx-2 text-white/20">|</span>
                  Collected:{' '}
                  <span className="text-foreground font-semibold">
                    ₨{(stats?.cashCollected ?? 0).toLocaleString()}
                  </span>
                </div>
                <DiscrepancyBadge />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failure Breakdown */}
      {!isLoading && failureEntries.length > 0 && (
        <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-4">
              Failure Breakdown
            </p>
            <div className="space-y-3">
              {failureEntries.map(([category, count]) => (
                <div key={category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {category.replace(/_/g, ' ')}
                    </span>
                    <span className="font-semibold text-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${(count / maxFailureCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Closed Sheets List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
            Closed Sheets
          </p>
          {!isLoading && allSheets.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        ) : pagedSheets.length === 0 ? (
          <Card className="bg-card/20 border border-white/5 rounded-2xl">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No closed sheets for this month
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pagedSheets.map((sheet) => (
              <button
                key={sheet.id}
                onClick={() => router.push(`/dashboard/daily-sheets/${sheet.id}`)}
                className="w-full text-left"
              >
                <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl hover:border-primary/30 hover:bg-card/60 transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <span className="text-xs font-semibold text-muted-foreground w-14 shrink-0">
                          {formatSheetDate(sheet.date)}
                        </span>
                        <span className="text-sm font-semibold text-foreground truncate">
                          {sheet.van}
                        </span>
                        {sheet.route && (
                          <span className="text-xs text-muted-foreground hidden sm:block truncate">
                            {sheet.route}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            sheet.deliveredItems === sheet.totalItems
                              ? 'text-emerald-500'
                              : 'text-amber-500',
                          )}
                        >
                          {sheet.deliveredItems}/{sheet.totalItems}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ₨{sheet.cashCollected.toLocaleString()}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'amber' | 'red';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-sm font-semibold',
          accent === 'green' && 'text-emerald-500',
          accent === 'amber' && 'text-amber-500',
          accent === 'red' && 'text-red-500',
          !accent && 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}
