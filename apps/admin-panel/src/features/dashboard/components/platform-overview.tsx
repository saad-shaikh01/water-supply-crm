'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge, cn } from '@water-supply-crm/ui';
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Users,
  Truck,
  TrendingUp,
  Wallet,
  PackageCheck,
  type LucideIcon,
} from 'lucide-react';
import { usePlatformOverview } from '../hooks/use-dashboard';
import { ErrorState } from '../../../components/shared/error-state';
import { EmptyState } from '../../../components/shared/empty-state';
import { formatCurrency, formatNumber, formatPercent } from '../../../lib/format';

interface Kpi {
  id: string;
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: 'destructive';
  badge?: { text: string; variant: 'success' | 'destructive' | 'secondary' };
}

export function PlatformOverviewView() {
  const { data, isLoading, error, refetch } = usePlatformOverview();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="overview-skeleton">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Could not load platform overview"
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const growth = Number(data.revenue?.growthPercent ?? 0);
  const growthVariant = growth > 0 ? 'success' : growth < 0 ? 'destructive' : 'secondary';
  const suspended = Number(data.vendors?.suspended ?? 0);

  const kpis: Kpi[] = [
    {
      id: 'vendors-total',
      label: 'Total Vendors',
      value: formatNumber(data.vendors?.total),
      sub: `+${formatNumber(data.vendors?.newThisMonth)} this month`,
      icon: Building2,
    },
    { id: 'vendors-active', label: 'Active Vendors', value: formatNumber(data.vendors?.active), icon: CheckCircle2 },
    {
      id: 'vendors-suspended',
      label: 'Suspended Vendors',
      value: formatNumber(suspended),
      icon: PauseCircle,
      tone: suspended > 0 ? 'destructive' : undefined,
    },
    { id: 'customers', label: 'Total Customers', value: formatNumber(data.customers?.total), icon: Users },
    { id: 'drivers', label: 'Active Drivers', value: formatNumber(data.drivers?.totalActive), icon: Truck },
    {
      id: 'revenue-month',
      label: 'Revenue This Month',
      value: formatCurrency(data.revenue?.thisMonth),
      sub: `Last month ${formatCurrency(data.revenue?.lastMonth)}`,
      icon: TrendingUp,
      badge: { text: formatPercent(growth), variant: growthVariant },
    },
    { id: 'revenue-all', label: 'All-Time Revenue', value: formatCurrency(data.revenue?.allTime), icon: Wallet },
    {
      id: 'deliveries',
      label: 'Deliveries This Month',
      value: formatNumber(data.deliveries?.thisMonth),
      icon: PackageCheck,
    },
  ];

  const topVendors = data.topVendors ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.id} data-testid={`kpi-${k.id}`} className={cn(k.tone === 'destructive' && 'border-destructive/40 bg-destructive/5')}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
                <Icon className={cn('h-4 w-4 text-muted-foreground', k.tone === 'destructive' && 'text-destructive')} />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{k.value}</p>
                  {k.badge && (
                    <Badge variant={k.badge.variant} data-testid="growth-badge">
                      {k.badge.text}
                    </Badge>
                  )}
                </div>
                {k.sub && <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Vendors</CardTitle>
        </CardHeader>
        <CardContent>
          {topVendors.length === 0 ? (
            <EmptyState title="No revenue yet" description="Top vendors by revenue will appear here." />
          ) : (
            <ol className="divide-y" data-testid="top-vendors">
              {topVendors.map((tv, i) => (
                <li key={tv.vendor.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-sm font-semibold text-muted-foreground">{i + 1}</span>
                    <div>
                      <Link href="/vendors" className="font-medium hover:underline">
                        {tv.vendor.name ?? tv.vendor.id}
                      </Link>
                      {tv.vendor.slug && (
                        <p className="font-mono text-xs text-muted-foreground">{tv.vendor.slug}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-semibold">{formatCurrency(tv.totalRevenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
