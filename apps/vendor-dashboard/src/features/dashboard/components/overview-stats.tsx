'use client';

import { Users, Package, Truck, DollarSign, ClipboardList, TrendingUp, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge } from '@water-supply-crm/ui';
import { useOverviewStats } from '../hooks/use-dashboard';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  trend?: string;
}

function StatCard({ title, value, icon: Icon, description, trend }: StatCardProps) {
  return (
    <Card className="group bg-white/[0.03] backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl hover:border-primary/20 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/80 group-hover:text-primary transition-colors">
          {title}
        </CardTitle>
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="font-mono tabular-nums text-2xl font-bold tracking-tight mb-2 text-foreground dark:text-white">{value}</div>
        <div className="flex items-center gap-2">
          {trend && (
            <Badge variant="success" className="gap-0.5 normal-case tracking-normal">
              <ArrowUpRight className="h-3 w-3" />
              {trend}
            </Badge>
          )}
          {description && <p className="text-[11px] font-medium text-muted-foreground/60 truncate uppercase tracking-wider">{description}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewStats() {
  const { data, isLoading } = useOverviewStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  const stats = (data ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Total Customers"
        value={String(stats.totalCustomers ?? 0)}
        icon={Users}
        description="Active customers"
      />
      <StatCard 
        title="Products" 
        value={String(stats.totalProducts ?? 0)} 
        icon={Package} 
        description="Inventory variety" 
      />
      <StatCard 
        title="Routes" 
        value={String(stats.totalRoutes ?? 0)} 
        icon={Truck} 
        description="Coverage area" 
      />
      <StatCard 
        title="Today's Sheets" 
        value={String(stats.todaySheets ?? 0)} 
        icon={ClipboardList} 
        description="Operations today" 
        trend="Live"
      />
      <StatCard
        title="Revenue This Month"
        value={`₨${Number(stats.monthlyRevenue ?? 0).toLocaleString()}`}
        icon={DollarSign}
        description="Collections this month"
      />
      <StatCard 
        title="Pending Balance" 
        value={`₨${Number(stats.totalOutstandingBalance ?? 0).toLocaleString()}`} 
        icon={TrendingUp} 
        description="Collection required" 
      />
    </div>
  );
}

