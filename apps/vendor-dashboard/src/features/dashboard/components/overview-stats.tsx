'use client';

import { Users, Package, Truck, DollarSign, ClipboardList, TrendingUp, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
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
    <Card className="premium-card group relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground group-hover:text-primary transition-colors">
          {title}
        </CardTitle>
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary transition-colors shadow-inner">
          <Icon className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight mb-2 text-white">{value}</div>
        <div className="flex items-center gap-2">
          {trend && (
            <span className="premium-badge premium-badge-success flex items-center">
              <ArrowUpRight className="h-3 w-3 mr-0.5" />
              {trend}
            </span>
          )}
          {description && <p className="text-[11px] font-medium text-muted-foreground/60 truncate uppercase tracking-wider">{description}</p>}
        </div>
      </CardContent>
      {/* Background glow - simplified to static */}
      <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-primary/5 blur-[50px] rounded-full" />
    </Card>
  );
}

export function OverviewStats() {
  const { data, isLoading } = useOverviewStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  const stats = (data ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

