'use client';

import { UserCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useStaffPerformance } from '../hooks/use-dashboard';

export function StaffPerformanceWidget() {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = startOfMonth.toISOString().split('T')[0];
  const to = today.toISOString().split('T')[0];
  
  const { data, isLoading } = useStaffPerformance(from, to);
  const rows = (Array.isArray(data) ? data : (data as any)?.data ?? []) as Array<{
    driver: { id: string; name: string };
    stats: {
      totalSheets: number;
      totalItems: number;
      deliveredItems: number;
      completionRate: number;
      totalBottlesDelivered: number;
      totalCashCollected: number;
    };
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
        ) : rows.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground/50 text-center py-8 uppercase tracking-widest">No performance data</p>
        ) : (
          rows.map((row, i) => (
            <div key={row.driver?.id || `staff-${i}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.03] transition-colors group/staff border border-transparent hover:border-white/5">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0 shadow-inner">
                {row.driver?.name?.charAt(0) ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white/90 truncate">{row.driver?.name ?? 'Unknown'}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[60px]">
                    <div 
                      className="h-full bg-primary rounded-full" 
                      style={{ width: `${row.stats.completionRate}%` }} 
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground/60 font-bold tracking-tighter">{row.stats.completionRate}% RATE</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-white/90 tabular-nums">
                  {row.stats.deliveredItems} <span className="text-[10px] text-muted-foreground/40 font-medium uppercase tracking-tighter">del.</span>
                </p>
                <p className="text-[11px] text-emerald-400 font-bold tabular-nums">
                  ₨{Number(row.stats.totalCashCollected).toLocaleString()}
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
