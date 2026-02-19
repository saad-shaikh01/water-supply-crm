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
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Map className="h-4 w-4 text-primary" /> Route Performance — Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)
        ) : routes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No sheets generated today</p>
        ) : (
          routes.map((r) => {
            const rate = r.completionRate ?? (r.totalDeliveries
              ? Math.round(((r.completedDeliveries ?? 0) / r.totalDeliveries) * 100)
              : 0);
            return (
              <div key={r.id} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold">{r.name}</span>
                  <Badge className={cn(
                    "text-[10px] font-bold border-none",
                    rate >= 80 ? "bg-emerald-500/10 text-emerald-500" :
                    rate >= 50 ? "bg-yellow-500/10 text-yellow-600" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {rate}%
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-yellow-500" : "bg-muted-foreground")}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {r.completedDeliveries ?? 0}/{r.totalDeliveries ?? 0}
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
