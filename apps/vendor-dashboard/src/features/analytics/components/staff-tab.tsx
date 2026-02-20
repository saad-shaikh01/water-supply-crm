'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useStaffAnalytics } from '../hooks/use-analytics';
import { cn } from '@water-supply-crm/ui';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function RateBadge({ rate }: { rate: number }) {
  const color = rate >= 90 ? 'bg-emerald-500/20 text-emerald-400' : rate >= 70 ? 'bg-amber-500/20 text-amber-400' : 'bg-destructive/20 text-destructive';
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', color)}>
      {rate}%
    </span>
  );
}

export function StaffTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useStaffAnalytics(from, to);
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
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
        <Skeleton className="h-[300px] w-full rounded-2xl" />
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const staff: any[] = d.staff ?? [];

  if (staff.length === 0) {
    return (
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardContent className="py-16 text-center">
          <p className="text-muted-foreground text-sm">No staff data for selected period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Deliveries per driver */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Deliveries per Driver</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={staff} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={90} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="deliveries" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} name="Deliveries" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Cash collected per driver */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Cash Collected per Driver</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={staff} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                <Bar dataKey="cashCollected" fill="#10b981" radius={[0, 4, 4, 0]} barSize={18} name="Cash Collected" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Staff Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-widest border-b border-border/50">
                  <th className="pb-3 pr-4">#</th>
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Role</th>
                  <th className="pb-3 pr-4 text-right">Deliveries</th>
                  <th className="pb-3 pr-4 text-right">Bottles</th>
                  <th className="pb-3 pr-4 text-right">Cash</th>
                  <th className="pb-3 text-center">Rate</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s: any, i: number) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                    <td className="py-3 pr-4 font-bold text-muted-foreground">{i + 1}</td>
                    <td className="py-3 pr-4 font-semibold">{s.name}</td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground capitalize">{s.role?.toLowerCase().replace('_', ' ')}</td>
                    <td className="py-3 pr-4 text-right font-mono">{s.deliveries}</td>
                    <td className="py-3 pr-4 text-right font-mono">{s.bottlesDelivered}</td>
                    <td className="py-3 pr-4 text-right font-mono">{fmt(s.cashCollected)}</td>
                    <td className="py-3 text-center"><RateBadge rate={s.completionRate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
