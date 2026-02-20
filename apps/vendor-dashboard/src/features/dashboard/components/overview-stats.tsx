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
      <Card className="group relative overflow-hidden border-border dark:border-white/10 bg-card/40 backdrop-blur-xl shadow-glass hover:shadow-premium hover:border-primary/30 transition-all duration-500 rounded-[2rem]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/80 group-hover:text-primary transition-colors">
            {title}
          </CardTitle>
          <div className="h-10 w-10 rounded-2xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500 shadow-inner">
            <Icon className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-extrabold tracking-tight mb-2 text-foreground">{value}</div>
          <div className="flex items-center gap-2">
            {trend && (
              <span className="flex items-center text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                <ArrowUpRight className="h-3 w-3 mr-0.5" />
                {trend}
              </span>
            )}
            {description && <p className="text-[11px] font-semibold text-muted-foreground/60 truncate uppercase tracking-wider">{description}</p>}
          </div>
        </CardContent>
        {/* Animated background glow */}
        <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-primary/5 blur-[50px] rounded-full group-hover:bg-primary/20 transition-all duration-700" />
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
        description="Active customers"
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
        description="Collections this month"
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
