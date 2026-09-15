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
import { CalendarCheck, CalendarX, CalendarClock, CalendarOff, CalendarRange } from 'lucide-react';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function RateBadge({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-xs text-muted-foreground">N/A</span>;
  const color = rate >= 90 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : rate >= 70 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-destructive/20 text-destructive';
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', color)}>
      {rate}%
    </span>
  );
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-black uppercase tracking-widest text-muted-foreground pt-2">{children}</p>;
}

export function StaffTab({ from, to, vanId }: { from: string; to: string; vanId?: string }) {
  const { data, isLoading } = useStaffAnalytics(from, to, vanId);
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
  const attendanceByStaff: any[] = d.attendance?.byStaff ?? [];
  const attendanceSummary = d.attendance?.summary ?? { present: 0, absent: 0, halfDay: 0, leave: 0, weeklyOff: 0, overallAttendanceRate: null };

  if (staff.length === 0 && attendanceByStaff.length === 0) {
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
      {staff.length > 0 && (
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
      )}

      {/* Leaderboard */}
      {staff.length > 0 && (
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
      )}

      {/* Attendance — covers every crew role (driver/salesman/loader), not
          just drivers, so it's a separate section rather than folded into
          the driver-only leaderboard above. */}
      {attendanceByStaff.length > 0 && (
        <>
          <SectionTitle>Staff Attendance</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Present Days" value={String(attendanceSummary.present)} icon={CalendarCheck} />
            <StatCard label="Absent Days" value={String(attendanceSummary.absent)} icon={CalendarX} />
            <StatCard label="Half Days" value={String(attendanceSummary.halfDay)} icon={CalendarClock} />
            <StatCard label="Leave Days" value={String(attendanceSummary.leave)} icon={CalendarOff} />
            <StatCard
              label="Overall Attendance Rate"
              value={attendanceSummary.overallAttendanceRate == null ? 'N/A' : `${attendanceSummary.overallAttendanceRate}%`}
              icon={CalendarRange}
            />
          </div>

          <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Attendance by Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-widest border-b border-border/50">
                      <th className="pb-3 pr-4">Name</th>
                      <th className="pb-3 pr-4">Role</th>
                      <th className="pb-3 pr-4 text-right">Present</th>
                      <th className="pb-3 pr-4 text-right">Absent</th>
                      <th className="pb-3 pr-4 text-right">Half Day</th>
                      <th className="pb-3 pr-4 text-right">Leave</th>
                      <th className="pb-3 text-center">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceByStaff.map((a: any) => (
                      <tr key={a.userId} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                        <td className="py-3 pr-4 font-semibold">{a.name}</td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground capitalize">{a.role?.toLowerCase().replace('_', ' ')}</td>
                        <td className="py-3 pr-4 text-right font-mono text-emerald-500">{a.present}</td>
                        <td className="py-3 pr-4 text-right font-mono text-destructive">{a.absent}</td>
                        <td className="py-3 pr-4 text-right font-mono text-amber-500">{a.halfDay}</td>
                        <td className="py-3 pr-4 text-right font-mono text-muted-foreground">{a.leave}</td>
                        <td className="py-3 text-center"><RateBadge rate={a.attendanceRate} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
