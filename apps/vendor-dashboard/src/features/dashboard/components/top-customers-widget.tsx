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
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-500" /> Top Customers
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
            <div key={c.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-accent/30 transition-colors">
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0",
                i === 0 ? "bg-yellow-500/20 text-yellow-600" :
                i === 1 ? "bg-zinc-400/20 text-zinc-500" :
                i === 2 ? "bg-orange-500/20 text-orange-600" :
                "bg-accent text-muted-foreground"
              )}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{c.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{c.customerCode}</p>
              </div>
              {(c.totalValue !== undefined || c.deliveries !== undefined) && (
                <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
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
