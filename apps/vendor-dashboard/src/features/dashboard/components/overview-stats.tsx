'use client';

import { Users, Package, Truck, DollarSign, ClipboardList, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useOverviewStats } from '../hooks/use-dashboard';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}

function StatCard({ title, value, icon: Icon, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

export function OverviewStats() {
  const { data, isLoading } = useOverviewStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  const stats = (data ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <StatCard title="Total Customers" value={String(stats.totalCustomers ?? 0)} icon={Users} description="Active customers" />
      <StatCard title="Products" value={String(stats.totalProducts ?? 0)} icon={Package} description="Active products" />
      <StatCard title="Routes" value={String(stats.totalRoutes ?? 0)} icon={Truck} description="Active routes" />
      <StatCard title="Today's Sheets" value={String(stats.todaySheets ?? 0)} icon={ClipboardList} description="Generated today" />
      <StatCard title="Revenue This Month" value={`$${Number(stats.monthlyRevenue ?? 0).toLocaleString()}`} icon={DollarSign} description="Current month" />
      <StatCard title="Pending Balance" value={`$${Number(stats.pendingBalance ?? 0).toLocaleString()}`} icon={TrendingUp} description="Outstanding payments" />
    </div>
  );
}
