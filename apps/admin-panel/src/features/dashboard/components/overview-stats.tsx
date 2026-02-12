'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { Building2, Users, TrendingUp, Activity } from 'lucide-react';
import { useOverviewStats } from '../hooks/use-dashboard';

export function OverviewStats() {
  const { data, isLoading } = useOverviewStats();
  const stats = (data ?? {}) as Record<string, unknown>;

  const cards = [
    {
      label: 'Total Vendors',
      value: stats.totalVendors ?? stats.vendorCount ?? '—',
      icon: Building2,
      description: 'Active vendor accounts on the platform',
    },
    {
      label: 'Total Customers',
      value: stats.totalCustomers ?? stats.customerCount ?? '—',
      icon: Users,
      description: 'Across all vendors',
    },
    {
      label: 'Platform Revenue',
      value: stats.totalRevenue != null ? `Rs. ${Number(stats.totalRevenue).toLocaleString()}` : '—',
      icon: TrendingUp,
      description: 'All-time platform transactions',
    },
    {
      label: 'Active Today',
      value: stats.activeSheetsToday ?? stats.todayDeliveries ?? '—',
      icon: Activity,
      description: 'Daily sheets in progress',
    },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{String(card.value)}</p>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
