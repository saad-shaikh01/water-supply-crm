'use client';

import { useRevenueStats } from '../hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useCan } from '../../authz/hooks/use-can';
import { useTheme } from 'next-themes';

export function RevenueChart() {
  // GET /dashboard/revenue is gated server-side by analytics:view (not a VENDOR_ADMIN-only
  // role check) — manager/accountant/vendor_admin/super_admin presets all hold it.
  const canView = useCan('analytics:view');
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 7);

  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  const { data, isLoading } = useRevenueStats(formatDate(from), formatDate(to), canView);

  if (!canView) return null;
  if (isLoading) return <Skeleton className="h-[350px] w-full rounded-2xl bg-white/[0.03]" />;

  const chartData = (data as any[] ?? []).map((d: any) => ({
    name: new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }),
    total: d.revenue,
  }));

  return (
    <Card className="col-span-4 bg-white/[0.03] backdrop-blur-2xl border-white/10 shadow-2xl rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground/80">Weekly Revenue</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#94a3b8" 
              fontSize={10} 
              tickLine={false} 
              axisLine={false} 
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `₨${value}`}
            />
            <Tooltip
              cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }}
              contentStyle={{
                backgroundColor: isDark ? 'rgba(10, 10, 15, 0.95)' : '#ffffff',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0,0,0,0.08)',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold',
                color: isDark ? '#fff' : '#111',
                backdropFilter: 'blur(10px)',
              }}
            />
            <Bar
              dataKey="total"
              fill="#6366f1"
              radius={[4, 4, 0, 0]}
              barSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
