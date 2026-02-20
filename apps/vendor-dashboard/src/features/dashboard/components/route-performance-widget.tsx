'use client';

import { Map, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge } from '@water-supply-crm/ui';
import { useRoutePerformance } from '../hooks/use-dashboard';
import { cn } from '@water-supply-crm/ui';

export function RoutePerformanceWidget() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useRoutePerformance(today);
  const routes = (Array.isArray(data) ? data : (data as any)?.data ?? []) as Array<{
    id: string;
    name: string;
    completedDeliveries?: number;
    totalDeliveries?: number;
    completionRate?: number;
  }>;

  return (
    <Card className="bg-[#05070a] border border-white/5 rounded-xl shadow-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
          <Map className="h-4 w-4 text-primary" /> Route Performance — Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl bg-white/[0.02]" />)
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2 opacity-30">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">No sheets generated</p>
          </div>
        ) : (
          routes.map((r, i) => {
            const rate = r.completionRate ?? (r.totalDeliveries
              ? Math.round(((r.completedDeliveries ?? 0) / r.totalDeliveries) * 100)
              : 0);
            return (
              <div key={r.id || `route-${i}`} className="space-y-2 group/route">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white/80 group-hover/route:text-white transition-colors">{r.name}</span>
                  <Badge className={cn(
                    "text-[10px] font-bold border-none px-2 py-0.5 rounded-full",
                    rate >= 80 ? "bg-emerald-500/10 text-emerald-500" :
                    rate >= 50 ? "bg-yellow-500/10 text-yellow-500" :
                    "bg-white/5 text-muted-foreground"
                  )}>
                    {rate}%
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        rate >= 80 ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" : 
                        rate >= 50 ? "bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]" : 
                        "bg-white/20"
                      )}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40 font-bold tabular-nums shrink-0">
                    {r.completedDeliveries ?? 0} <span className="opacity-30">/</span> {r.totalDeliveries ?? 0}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
