'use client';

import { UserCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useStaffPerformance } from '../hooks/use-dashboard';

export function StaffPerformanceWidget() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const { data, isLoading } = useStaffPerformance(from, to);
  const staff = (Array.isArray(data) ? data : (data as any)?.data ?? []) as Array<{
    id: string;
    name: string;
    role: string;
    deliveries?: number;
    cashCollected?: number;
    completionRate?: number;
  }>;

  return (
    <Card className="bg-white/[0.03] backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80 flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" /> Staff — This Month
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl bg-white/[0.02]" />)
        ) : staff.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground/50 text-center py-8 uppercase tracking-widest">No performance data</p>
        ) : (
          staff.map((s, i) => (
            <div key={s.id || `staff-${i}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.03] transition-colors group/staff border border-transparent hover:border-white/5">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0 shadow-inner">
                {s.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white/90 truncate">{s.name}</p>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-tighter font-semibold">{s.role?.toLowerCase()}</p>
              </div>
              <div className="text-right shrink-0">
                {s.deliveries !== undefined && (
                  <p className="text-sm font-bold text-white/90 tabular-nums">
                    {s.deliveries} <span className="text-[10px] text-muted-foreground/40 font-medium uppercase tracking-tighter">del.</span>
                  </p>
                )}
                {s.cashCollected !== undefined && (
                  <p className="text-[11px] text-emerald-400 font-bold tabular-nums">
                    ₨{Number(s.cashCollected).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
