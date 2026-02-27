'use client';

import { Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Badge } from '@water-supply-crm/ui';
import { useTopCustomers } from '../hooks/use-dashboard';
import { cn } from '@water-supply-crm/ui';

export function TopCustomersWidget() {
  const { data, isLoading } = useTopCustomers(5);
  const customers = (Array.isArray(data) ? data : (data as any)?.data ?? []) as Array<{
    id: string;
    name: string;
    customerCode: string;
    totalValue?: number;
    deliveries?: number;
  }>;

  return (
    <Card className="bg-white/[0.03] backdrop-blur-2xl border-white/10 rounded-2xl shadow-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground/80 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" /> Top Customers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-xl" />
          ))
        ) : customers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
        ) : (
          customers.map((c, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                i === 0 ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                i === 1 ? "bg-slate-400/10 text-slate-400 border border-slate-400/20" :
                i === 2 ? "bg-orange-500/10 text-orange-400 border border-orange-500/20" :
                "bg-white/5 text-muted-foreground border border-white/5"
              )}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-white">{c.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground/60">{c.customerCode}</p>
              </div>
              {(c.totalValue !== undefined || c.deliveries !== undefined) && (
                <Badge variant="outline" className="text-[10px] font-mono shrink-0 bg-white/5 border-white/10 text-white/70">
                  {c.totalValue !== undefined
                    ? `₨${Number(c.totalValue).toLocaleString()}`
                    : `${c.deliveries} del.`}
                </Badge>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
