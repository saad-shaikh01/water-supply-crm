'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useVendorReadiness, useVendorStats } from '../../hooks/use-vendor-detail';
import { ErrorState } from '../../../../components/shared/error-state';
import { formatCurrency, formatNumber } from '../../../../lib/format';
import type { VendorRow } from '../../types';
import type { VendorTab } from './vendor-detail-client';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums" data-stat={label}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

export function OverviewTab({ vendor, onOpenTab }: { vendor: VendorRow; onOpenTab: (t: VendorTab) => void }) {
  const stats = useVendorStats(vendor.id);
  const readiness = useVendorReadiness(vendor.id);

  if (stats.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (stats.error || !stats.data) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;

  const s = stats.data.stats;
  const required = readiness.data?.items.filter((i) => i.required) ?? [];
  const requiredDone = required.filter((i) => i.status === 'DONE').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={formatNumber(s.totalCustomers)} />
        <StatCard label="Drivers" value={formatNumber(s.totalDrivers)} />
        <StatCard label="Routes" value={formatNumber(s.totalRoutes)} />
        <StatCard label="Vans" value={formatNumber(s.totalVans)} />
        <StatCard label="Team users" value={`${formatNumber(s.activeUsers)} active / ${formatNumber(s.inactiveUsers)} inactive`} />
        <StatCard label="Customer logins" value={formatNumber(s.customerUsers)} />
        <StatCard label="Revenue this month" value={formatCurrency(s.revenueThisMonth)} />
        <StatCard label="Lifetime revenue" value={formatCurrency(s.totalRevenue)} />
        <StatCard label="Outstanding balance" value={formatCurrency(s.outstandingBalance)} />
        <StatCard label="Deliveries this month" value={formatNumber(s.deliveriesThisMonth)} />
        <StatCard label="Daily sheets this month" value={formatNumber(s.sheetsThisMonth)} />
        <StatCard label="Last activity" value={s.lastActiveDate ? fmtDate(s.lastActiveDate) : 'No activity yet'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendor info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Address</dt>
              <dd>{vendor.address || '—'}</dd>
              <dt className="text-muted-foreground">Raast ID</dt>
              <dd>{vendor.raastId || '—'}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{fmtDate(vendor.createdAt)}</dd>
              <dt className="text-muted-foreground">Went live</dt>
              <dd>{vendor.goLiveAt ? fmtDate(vendor.goLiveAt) : 'Not live yet'}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Go-live readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {readiness.isLoading && <Skeleton className="h-5 w-40" />}
            {readiness.data && (
              <p>
                <strong>{requiredDone}</strong> of <strong>{required.length}</strong> required items done
                {readiness.data.live ? ' - vendor is live' : ''}
              </p>
            )}
            {readiness.error && <p className="text-muted-foreground">Readiness is unavailable right now.</p>}
            <button type="button" className="text-primary underline" onClick={() => onOpenTab('readiness')}>
              View checklist
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
