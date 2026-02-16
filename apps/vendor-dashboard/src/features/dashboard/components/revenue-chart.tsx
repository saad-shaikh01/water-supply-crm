'use client';

import { useRevenueStats } from '../hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useTheme } from 'next-themes';

export function RevenueChart() {
  // Last 7 days
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 7);
  
  const { data, isLoading } = useRevenueStats(from.toISOString(), to.toISOString());
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  if (isLoading) return <Skeleton className="h-[350px] w-full rounded-3xl" />;

  const chartData = (data as any[] ?? []).map((d: any) => ({
    name: new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }),
    total: d.totalRevenue,
  }));

  return (
    <Card className="col-span-4 bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader>
        <CardTitle className="text-base font-bold uppercase tracking-widest text-muted-foreground">Weekly Revenue</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#333' : '#eee'} vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#888888" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false} 
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `₨${value}`}
            />
            <Tooltip
              cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
              contentStyle={{
                backgroundColor: isDark ? '#18181b' : '#ffffff',
                border: '1px solid rgba(128,128,128,0.2)',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
            />
            <Bar
              dataKey="total"
              fill="currentColor"
              radius={[4, 4, 0, 0]}
              className="fill-primary"
              barSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
