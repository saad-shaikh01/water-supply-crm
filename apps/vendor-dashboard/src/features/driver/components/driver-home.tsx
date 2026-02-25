'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { ArrowRight, CheckCircle2, Clock, Truck } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../../store/auth.store';
import { useDriverStats } from '../hooks/use-driver';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getWeekBounds() {
  const today = new Date();
  const day = today.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return {
    dateFrom: monday.toISOString().split('T')[0],
    dateTo: today.toISOString().split('T')[0],
  };
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function DriverHome() {
  const user = useAuthStore((s) => s.user);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Today's sheets — query directly (DRIVER role: backend enforces their own driverId)
  const { data: todayPage, isLoading: sheetsLoading } = useQuery({
    queryKey: ['driver', 'today-sheet', user?.id, todayStr],
    queryFn: () =>
      dailySheetsApi
        .getAll({ dateFrom: todayStr, dateTo: todayStr, driverId: user?.id })
        .then((r) => r.data),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const todaySheet = (todayPage as any)?.data?.[0] ?? null;

  const weekBounds = getWeekBounds();
  const { data: weekStats, isLoading: weekLoading } = useDriverStats({
    dateFrom: weekBounds.dateFrom,
    dateTo: weekBounds.dateTo,
  });

  const { data: monthStats, isLoading: monthLoading } = useDriverStats({
    month: getCurrentMonth(),
  });

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {getGreeting()}, {user?.name?.split(' ')[0] ?? 'Driver'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{formatDate(today)}</p>
        </div>
      </div>

      {/* Today's Sheet */}
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-3">
          Today's Sheet
        </p>
        {sheetsLoading ? (
          <Skeleton className="h-28 rounded-2xl" />
        ) : todaySheet ? (
          <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl hover:border-primary/30 transition-all">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Truck className="h-4 w-4 text-primary" />
                    <span>{todaySheet.van?.plateNumber ?? '—'}</span>
                    {todaySheet.route?.name && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{todaySheet.route.name}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1.5 text-amber-500">
                      <Clock className="h-3.5 w-3.5" />
                      Items: {todaySheet._count?.items ?? 0}
                    </span>
                    <span
                      className={cn(
                        'flex items-center gap-1.5',
                        todaySheet.isClosed ? 'text-muted-foreground' : 'text-emerald-500',
                      )}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {todaySheet.isClosed ? 'Closed' : 'Open'}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/dashboard/daily-sheets/${todaySheet.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors whitespace-nowrap"
                >
                  Open Sheet <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/20 border border-white/5 rounded-2xl">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No sheet assigned for today
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* This Week */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-3">
            This Week
          </p>
          <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl">
            <CardContent className="p-5 space-y-3">
              {weekLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ) : (
                <>
                  <StatRow
                    label="Deliveries"
                    value={`${weekStats?.deliveredCount ?? 0} / ${weekStats?.totalItems ?? 0}`}
                  />
                  <StatRow
                    label="Cash Collected"
                    value={`₨${(weekStats?.cashCollected ?? 0).toLocaleString()}`}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* This Month */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-3">
            This Month
          </p>
          <Card className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl">
            <CardContent className="p-5 space-y-3">
              {monthLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ) : (
                <>
                  <StatRow
                    label="Success Rate"
                    value={`${monthStats?.successRate ?? 0}%`}
                    accent={
                      monthStats && monthStats.successRate >= 90 ? 'green' : 'amber'
                    }
                  />
                  <StatRow
                    label="Discrepancy"
                    value={
                      (monthStats?.cashDiscrepancy ?? 0) === 0
                        ? '₨0 ✓'
                        : `₨${Math.abs(monthStats?.cashDiscrepancy ?? 0).toLocaleString()} ${
                            (monthStats?.cashDiscrepancy ?? 0) > 0 ? 'short' : 'over'
                          }`
                    }
                    accent={
                      (monthStats?.cashDiscrepancy ?? 0) === 0 ? 'green' : 'red'
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
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
