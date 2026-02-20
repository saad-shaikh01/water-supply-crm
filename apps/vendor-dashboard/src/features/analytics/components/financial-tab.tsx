'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useFinancialAnalytics } from '../hooks/use-analytics';
import { TrendingUp, TrendingDown, DollarSign, Percent } from 'lucide-react';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

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
            <p className={`text-xl font-bold mt-0.5 ${positive === false ? 'text-destructive' : ''}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FinancialTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useFinancialAnalytics(from, to);
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#333' : '#eee';
  const tooltipStyle = {
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    border: '1px solid rgba(128,128,128,0.2)',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-[2rem]" />)}
        </div>
        <Skeleton className="h-[300px] w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const revenue = d.revenue?.total ?? 0;
  const expenses = d.expenses?.total ?? 0;
  const profit = d.profit?.total ?? 0;
  const collectionRate = d.collectionRate ?? 0;

  const profitByDay = (d.profit?.byDay ?? []).map((p: any) => ({
    date: p.date.slice(5), // MM-DD
    Revenue: p.revenue,
    Expenses: p.expenses,
    Profit: p.profit,
  }));

  const expensesByCategory = d.expenses?.byCategory ?? [];
  const revenueByRoute = (d.revenueByRoute ?? []).slice(0, 8);
  const { CASH = 0, MONTHLY = 0 } = d.revenueByPaymentType ?? {};

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={fmt(revenue)} icon={TrendingUp} />
        <StatCard label="Total Expenses" value={fmt(expenses)} icon={TrendingDown} positive={false} />
        <StatCard label="Gross Profit" value={fmt(profit)} icon={DollarSign} positive={profit >= 0} />
        <StatCard label="Collection Rate" value={`${collectionRate}%`} icon={Percent} />
      </div>

      {/* Revenue vs Expenses area chart */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue vs Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {profitByDay.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No data for selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={profitByDay}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                <Legend />
                <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" fill="url(#gradRevenue)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#gradExpenses)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Expenses by category */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No expense data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={expensesByCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3}>
                    {expensesByCategory.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Legend formatter={(v) => v.toLowerCase()} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by route */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue by Route</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No route data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueByRoute} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="routeName" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment type split */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue by Payment Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-12">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-500">{fmt(CASH)}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Cash</p>
            </div>
            <div className="h-16 w-px bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-emerald-500">{fmt(MONTHLY)}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Monthly</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
