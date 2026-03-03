'use client';

import { Map, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge } from '@water-supply-crm/ui';
import { useRoutePerformance } from '../hooks/use-dashboard';
import { cn } from '@water-supply-crm/ui';

export function RoutePerformanceWidget() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useRoutePerformance(today);
  const rows = (Array.isArray(data) ? data : (data as any)?.data ?? []) as Array<{
    route: { id: string; name: string };
    totalItems: number;
    completedItems: number;
    completionRate: number;
  }>;

  // Aggregate by route
  const routes = rows.reduce((acc, row) => {
    const routeId = row.route?.id;
    if (!routeId) return acc;
    
    if (!acc[routeId]) {
      acc[routeId] = {
        id: routeId,
        name: row.route.name,
        completedItems: 0,
        totalItems: 0,
      };
    }
    
    acc[routeId].completedItems += row.completedItems;
    acc[routeId].totalItems += row.totalItems;
    return acc;
  }, {} as Record<string, any>);

  const sortedRoutes = Object.values(routes).map(r => ({
    ...r,
    completionRate: r.totalItems > 0 ? Math.round((r.completedItems / r.totalItems) * 100) : 0
  })).sort((a, b) => b.completionRate - a.completionRate);

  return (
    <Card className="bg-white/[0.03] backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80 flex items-center gap-2">
          <Map className="h-4 w-4 text-primary" /> Route Performance — Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl bg-white/[0.02]" />)
        ) : sortedRoutes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-2 opacity-30">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">No sheets generated</p>
          </div>
        ) : (
          sortedRoutes.map((r) => {
            const rate = r.completionRate;
            return (
              <div key={r.id} className="space-y-2 group/route">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white/90">{r.name}</span>
                  <Badge className={cn(
                    "text-[10px] font-bold border px-2 py-0.5 rounded-full uppercase tracking-wider",
                    rate >= 80 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    rate >= 50 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                    "bg-white/5 text-muted-foreground border-white/10"
                  )}>
                    {rate}%
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        rate >= 80 ? "bg-emerald-500" : 
                        rate >= 50 ? "bg-amber-500" : 
                        "bg-white/20"
                      )}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40 font-bold tabular-nums shrink-0">
                    {r.completedItems} <span className="opacity-30">/</span> {r.totalItems}
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
