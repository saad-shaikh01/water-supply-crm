'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useCustomerAnalytics } from '../hooks/use-analytics';
import { Users, UserCheck, UserX, UserPlus } from 'lucide-react';

const PIE_COLORS = ['#3b82f6', '#10b981'];

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">{label}</p>
            <p className="text-xl font-bold mt-0.5">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CustomersTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useCustomerAnalytics(from, to);
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
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[280px] rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const { total = 0, active = 0, inactive = 0, newThisPeriod = 0 } = d.summary ?? {};
  const { CASH = 0, MONTHLY = 0 } = d.paymentTypeBreakdown ?? {};
  const growthByMonth = d.growthByMonth ?? [];
  const topByRevenue = (d.topByRevenue ?? []).slice(0, 10);
  const highestBalances = (d.highestBalances ?? []).slice(0, 10);

  const paymentPieData = [
    { name: 'Cash', value: CASH },
    { name: 'Monthly', value: MONTHLY },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Customers" value={String(total)} icon={Users} />
        <StatCard label="Active" value={String(active)} icon={UserCheck} />
        <StatCard label="New This Period" value={String(newThisPeriod)} icon={UserPlus} />
        <StatCard label="Inactive" value={String(inactive)} icon={UserX} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Growth chart */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Customer Growth (12 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={growthByMonth}>
                <defs>
                  <linearGradient id="gradCumulative" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="month" stroke="#888" fontSize={10} tickLine={false} axisLine={false} interval={2} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Area type="monotone" dataKey="cumulative" stroke="#3b82f6" fill="url(#gradCumulative)" strokeWidth={2} dot={false} name="Total Customers" />
                <Area type="monotone" dataKey="new" stroke="#10b981" fill="none" strokeWidth={2} dot={false} name="New This Month" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Payment type pie */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Customer by Payment Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={paymentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={4}>
                  {paymentPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top by revenue */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Top Customers by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {topByRevenue.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topByRevenue} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={10} tickLine={false} axisLine={false} width={90} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={16} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Highest balances */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Highest Outstanding Balances</CardTitle>
          </CardHeader>
          <CardContent>
            {highestBalances.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No outstanding balances</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={highestBalances} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={10} tickLine={false} axisLine={false} width={90} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="financialBalance" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={16} name="Balance" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
