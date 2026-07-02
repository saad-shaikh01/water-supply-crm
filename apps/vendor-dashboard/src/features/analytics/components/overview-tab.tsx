'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton, Button,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import {
  useFinancialAnalytics, useDeliveryAnalytics, useCustomerAnalytics, useStaffAnalytics,
} from '../hooks/use-analytics';
import {
  TrendingUp, TrendingDown, DollarSign, Percent, Package, CheckCircle2, Users, Wallet, ArrowRight,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function StatCard({ label, value, icon: Icon, positive }: { label: string; value: string; icon: any; positive?: boolean }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">{label}</p>
            <p className={cn('text-xl font-bold mt-0.5', positive === false && 'text-destructive')}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, onViewAll, children }: { title: string; onViewAll?: () => void; children: React.ReactNode }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
        {onViewAll && (
          <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs font-semibold gap-1 h-7 px-2">
            View full <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function OverviewTab({ from, to, onNavigate }: { from: string; to: string; onNavigate: (tab: string) => void }) {
  const { data: financial, isLoading: loadingFinancial } = useFinancialAnalytics(from, to);
  const { data: deliveries, isLoading: loadingDeliveries } = useDeliveryAnalytics(from, to);
  const { data: customers, isLoading: loadingCustomers } = useCustomerAnalytics(from, to);
  const { data: staff, isLoading: loadingStaff } = useStaffAnalytics(from, to);

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#333' : '#eee';
  const tooltipStyle = {
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    border: '1px solid rgba(128,128,128,0.2)',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: isDark ? '#fff' : '#111',
  };

  const isLoading = loadingFinancial || loadingDeliveries || loadingCustomers || loadingStaff;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-[2rem]" />)}
        </div>
        <Skeleton className="h-[300px] w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  const f = financial as any;
  const d = deliveries as any;
  const c = customers as any;
  const s = staff as any;

  const revenue = f?.revenue?.total ?? 0;
  const expenses = f?.expenses?.total ?? 0;
  const profit = f?.profit?.total ?? 0;
  const collectionRate = f?.collectionRate ?? 0;
  const cashByVan = f?.cashByVan ?? [];

  const totalDeliveries = d?.summary?.total ?? 0;
  const completionRate = d?.summary?.completionRate ?? 0;

  const totalCustomers = c?.summary?.total ?? 0;
  const outstandingBalance = f?.outstandingBalance ?? 0;
  const topCustomers = (c?.topByRevenue ?? []).slice(0, 5);

  const staffLeaderboard = (s?.staff ?? []).slice(0, 5);

  const profitByDay = (f?.profit?.byDay ?? []).map((p: any) => ({
    date: p.date.slice(5),
    Revenue: p.revenue,
    Expenses: p.expenses,
    Profit: p.profit,
  }));

  const deliveryStatus = [
    { label: 'Completed', value: d?.summary?.completed ?? 0 },
    { label: 'Missed', value: d?.summary?.missed ?? 0 },
    { label: 'Pending', value: d?.summary?.pending ?? 0 },
  ];

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={fmt(revenue)} icon={TrendingUp} />
        <StatCard label="Total Expenses" value={fmt(expenses)} icon={TrendingDown} positive={false} />
        <StatCard label="Gross Profit" value={fmt(profit)} icon={DollarSign} positive={profit >= 0} />
        <StatCard label="Collection Rate" value={`${collectionRate}%`} icon={Percent} />
        <StatCard label="Total Deliveries" value={String(totalDeliveries)} icon={Package} />
        <StatCard label="Completion Rate" value={`${completionRate}%`} icon={CheckCircle2} />
        <StatCard label="Total Customers" value={String(totalCustomers)} icon={Users} />
        <StatCard label="Outstanding Balance" value={fmt(outstandingBalance)} icon={Wallet} positive={outstandingBalance <= 0} />
      </div>

      {/* Revenue vs Expenses trend */}
      <SectionCard title="Revenue vs Expenses" onViewAll={() => onNavigate('financial')}>
        {profitByDay.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={profitByDay}>
              <defs>
                <linearGradient id="ovGradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ovGradExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
              <Legend />
              <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" fill="url(#ovGradRevenue)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#ovGradExpenses)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Cash collected by van */}
        <SectionCard title="Cash Collected by Van" onViewAll={() => onNavigate('financial')}>
          {cashByVan.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No van data for selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cashByVan} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="plateNumber" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={70} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                <Legend />
                <Bar dataKey="cashExpected" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={10} name="Expected" />
                <Bar dataKey="cashCollected" fill="#10b981" radius={[0, 4, 4, 0]} barSize={10} name="Collected" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Delivery status breakdown */}
        <SectionCard title="Delivery Status" onViewAll={() => onNavigate('deliveries')}>
          {totalDeliveries === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No delivery data for selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={deliveryStatus} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={70} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top customers */}
        <SectionCard title="Top 5 Customers by Revenue" onViewAll={() => onNavigate('customers')}>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No customer data for selected period</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {topCustomers.map((tc: any, i: number) => (
                  <tr key={tc.id ?? i} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-3 font-bold text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3 font-semibold">{tc.name}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{tc.customerCode}</td>
                    <td className="py-2 text-right font-mono">{fmt(tc.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* Staff leaderboard */}
        <SectionCard title="Staff Leaderboard (Top 5)" onViewAll={() => onNavigate('staff')}>
          {staffLeaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No staff data for selected period</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {staffLeaderboard.map((st: any, i: number) => (
                  <tr key={i} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-3 font-bold text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3 font-semibold">{st.name}</td>
                    <td className="py-2 pr-3 text-right font-mono">{st.deliveries} del</td>
                    <td className="py-2 text-right font-mono">{fmt(st.cashCollected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
