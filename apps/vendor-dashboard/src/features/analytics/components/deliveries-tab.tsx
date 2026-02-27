'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useDeliveryAnalytics } from '../hooks/use-analytics';
import { Package, CheckCircle, XCircle, Activity, AlertTriangle, Repeat, Clock3 } from 'lucide-react';

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color?: string }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${color ?? 'bg-primary/10'}`}>
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

export function DeliveriesTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useDeliveryAnalytics(from, to);
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
          <Skeleton className="h-[280px] rounded-2xl" />
          <Skeleton className="h-[280px] rounded-2xl" />
        </div>
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const { total = 0, completed = 0, missed = 0, completionRate = 0 } = d.summary ?? {};
  const byDay = (d.byDay ?? []).map((b: any) => ({ date: b.date.slice(5), Completed: b.completed, Missed: b.missed }));
  const byDayOfWeek = d.byDayOfWeek ?? [];
  const byRoute = (d.byRoute ?? []).slice(0, 10);
  const opsKpis = d.opsKpis ?? {};
  const issueAgingBuckets = opsKpis.issueAgingBuckets ?? {};

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Deliveries" value={String(total)} icon={Package} />
        <StatCard label="Completed" value={String(completed)} icon={CheckCircle} color="bg-emerald-500/10" />
        <StatCard label="Missed" value={String(missed)} icon={XCircle} color="bg-destructive/10" />
        <StatCard label="Completion Rate" value={`${completionRate}%`} icon={Activity} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open Issues" value={String(opsKpis.openIssues ?? 0)} icon={AlertTriangle} color="bg-destructive/10" />
        <StatCard
          label="Issue Aging"
          value={`${issueAgingBuckets.moreThan7d ?? 0} >7d`}
          icon={Clock3}
          color="bg-amber-500/10"
        />
        <StatCard
          label="On-Demand Fulfillment"
          value={opsKpis.onDemandFulfillmentRate == null ? 'N/A' : `${opsKpis.onDemandFulfillmentRate}%`}
          icon={Package}
          color="bg-blue-500/10"
        />
        <StatCard
          label="Retry Success"
          value={opsKpis.retrySuccessRate == null ? 'N/A' : `${opsKpis.retrySuccessRate}%`}
          icon={Repeat}
          color="bg-violet-500/10"
        />
      </div>

      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Issue Aging Buckets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: '< 1 Day', value: issueAgingBuckets.lessThan1d ?? 0, tone: 'text-emerald-500' },
              { label: '1-3 Days', value: issueAgingBuckets.oneToThreeDays ?? 0, tone: 'text-blue-500' },
              { label: '4-7 Days', value: issueAgingBuckets.fourToSevenDays ?? 0, tone: 'text-amber-500' },
              { label: '> 7 Days', value: issueAgingBuckets.moreThan7d ?? 0, tone: 'text-destructive' },
            ].map((bucket) => (
              <div key={bucket.label} className="rounded-2xl border border-border/50 bg-background/40 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{bucket.label}</p>
                <p className={`mt-2 text-2xl font-black ${bucket.tone}`}>{bucket.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stacked area chart by day */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Deliveries Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No data for selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={byDay}>
                <defs>
                  <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradMissed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Area type="monotone" dataKey="Completed" stroke="#10b981" fill="url(#gradCompleted)" strokeWidth={2} dot={false} stackId="1" />
                <Area type="monotone" dataKey="Missed" stroke="#ef4444" fill="url(#gradMissed)" strokeWidth={2} dot={false} stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Peak delivery days */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Peak Delivery Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byDayOfWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="label" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={28} name="Deliveries" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Completion rate by route */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Completion Rate by Route</CardTitle>
          </CardHeader>
          <CardContent>
            {byRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No route data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byRoute} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="routeName" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => `${v}%`} />
                  <Bar dataKey="rate" fill="#10b981" radius={[0, 4, 4, 0]} barSize={18} name="Completion %" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
