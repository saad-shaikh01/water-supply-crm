'use client';

import { Users, Package, Truck, DollarSign, ClipboardList, TrendingUp, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useOverviewStats } from '../hooks/use-dashboard';
import { motion } from 'framer-motion';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  trend?: string;
  index: number;
}

function StatCard({ title, value, icon: Icon, description, trend, index }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="group overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">
            {title}
          </CardTitle>
          <div className="p-2 rounded-lg bg-accent group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold tracking-tight">{value}</div>
          <div className="flex items-center gap-2 mt-1">
            {trend && (
              <span className="flex items-center text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                <ArrowUpRight className="h-3 w-3 mr-0.5" />
                {trend}
              </span>
            )}
            {description && <p className="text-xs text-muted-foreground truncate">{description}</p>}
          </div>
        </CardContent>
        {/* Subtle background glow */}
        <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-primary/5 blur-3xl rounded-full group-hover:bg-primary/10 transition-colors" />
      </Card>
    </motion.div>
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
        index={0}
        title="Total Customers" 
        value={String(stats.totalCustomers ?? 0)} 
        icon={Users} 
        description="Growth from last month" 
        trend="+12%"
      />
      <StatCard 
        index={1}
        title="Products" 
        value={String(stats.totalProducts ?? 0)} 
        icon={Package} 
        description="Inventory variety" 
      />
      <StatCard 
        index={2}
        title="Routes" 
        value={String(stats.totalRoutes ?? 0)} 
        icon={Truck} 
        description="Coverage area" 
      />
      <StatCard 
        index={3}
        title="Today's Sheets" 
        value={String(stats.todaySheets ?? 0)} 
        icon={ClipboardList} 
        description="Operations today" 
        trend="Live"
      />
      <StatCard 
        index={4}
        title="Revenue This Month" 
        value={`₨${Number(stats.monthlyRevenue ?? 0).toLocaleString()}`} 
        icon={DollarSign} 
        description="Target: ₨500k" 
        trend="+8%"
      />
      <StatCard 
        index={5}
        title="Pending Balance" 
        value={`₨${Number(stats.pendingBalance ?? 0).toLocaleString()}`} 
        icon={TrendingUp} 
        description="Collection required" 
      />
    </div>
  );
}
