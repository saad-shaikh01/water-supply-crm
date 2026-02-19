'use client';

import { UserCog } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge } from '@water-supply-crm/ui';
import { useStaffPerformance } from '../hooks/use-dashboard';
import { cn } from '@water-supply-crm/ui';

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
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" /> Staff — This Month
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No performance data</p>
        ) : (
          staff.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-accent/30 transition-colors">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-xs shrink-0">
                {s.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{s.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{s.role?.toLowerCase()}</p>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                {s.deliveries !== undefined && (
                  <p className="text-[11px] font-mono font-bold">{s.deliveries} del.</p>
                )}
                {s.cashCollected !== undefined && (
                  <p className="text-[10px] text-emerald-500 font-mono">₨{Number(s.cashCollected).toLocaleString()}</p>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
