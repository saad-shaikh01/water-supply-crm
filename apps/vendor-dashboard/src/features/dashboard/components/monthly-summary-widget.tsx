'use client';

import { CalendarRange } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Skeleton, cn,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useMonthlySummary } from '../hooks/use-dashboard';

type MonthRow = {
  month: string;
  bottlesDelivered: number;
  emptyReceived: number;
  filledReceived: number;
  cashExpected: number;
  cashCollected: number;
  collectionRate: number;
};

function fmtCash(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function RateBadge({ rate }: { rate: number }) {
  const color =
    rate >= 80 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    rate >= 50 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
    'bg-white/5 text-muted-foreground border-white/10';
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold border', color)}>
      {rate}%
    </span>
  );
}

export function MonthlySummaryWidget() {
  const { data, isLoading } = useMonthlySummary(6);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const gridColor = 'rgba(255,255,255,0.05)';
  const axisColor = '#94a3b8';
  const tooltipStyle = {
    backgroundColor: isDark ? 'rgba(10, 10, 15, 0.95)' : '#ffffff',
    border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0,0,0,0.08)',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: isDark ? '#fff' : '#111',
  };
  const legendStyle = { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' };

  const rows = (data ?? []) as MonthRow[];
  // Filled Received is rare (account closing / excess stock returns) — the bar
  // and table column only earn their place when at least one of the last 6
  // months actually has a value, same whole-series rule as the daily sheet PDF.
  const hasFilledReceived = rows.some((r) => (r.filledReceived ?? 0) > 0);

  return (
    <Card className="bg-white/[0.03] backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/80 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" /> Monthly Summary — Last 6 Months
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-[240px] rounded-xl bg-white/[0.02]" />
            <Skeleton className="h-[240px] rounded-xl bg-white/[0.02]" />
            <Skeleton className="h-[240px] rounded-xl bg-white/[0.02]" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground/50 text-center py-8 uppercase tracking-widest">No data yet</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2">Bottles</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="month" stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }} contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={legendStyle} />
                    <Bar dataKey="bottlesDelivered" name="Delivered" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={14} />
                    <Bar dataKey="emptyReceived" name="Empty Received" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={14} />
                    {hasFilledReceived && (
                      <Bar dataKey="filledReceived" name="Filled Received" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={14} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div>
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2">Cash</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="month" stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                    <Tooltip cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }} contentStyle={tooltipStyle} formatter={(v: any) => fmtCash(Number(v))} />
                    <Legend wrapperStyle={legendStyle} />
                    <Bar dataKey="cashExpected" name="Expected" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={14} />
                    <Bar dataKey="cashCollected" name="Collected" fill="#10b981" radius={[4, 4, 0, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div>
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-2">Collection Rate</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="month" stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke={axisColor} fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }} contentStyle={tooltipStyle} formatter={(v: any) => `${v}%`} />
                    <Bar dataKey="collectionRate" name="Rate" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] text-muted-foreground/60 uppercase tracking-widest border-b border-white/10">
                    <th className="pb-3 pr-4">Month</th>
                    <th className="pb-3 pr-4 text-right">Delivered</th>
                    <th className="pb-3 pr-4 text-right">Empty Recv.</th>
                    {hasFilledReceived && <th className="pb-3 pr-4 text-right">Filled Recv.</th>}
                    <th className="pb-3 pr-4 text-right">Cash Expected</th>
                    <th className="pb-3 pr-4 text-right">Cash Collected</th>
                    <th className="pb-3 text-center">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 pr-4 font-bold text-foreground dark:text-white/90">{r.month}</td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums">{r.bottlesDelivered.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums">{r.emptyReceived.toLocaleString()}</td>
                      {hasFilledReceived && (
                        <td className="py-3 pr-4 text-right font-mono tabular-nums">{r.filledReceived.toLocaleString()}</td>
                      )}
                      <td className="py-3 pr-4 text-right font-mono tabular-nums">{fmtCash(r.cashExpected)}</td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-emerald-400">{fmtCash(r.cashCollected)}</td>
                      <td className="py-3 text-center"><RateBadge rate={r.collectionRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
