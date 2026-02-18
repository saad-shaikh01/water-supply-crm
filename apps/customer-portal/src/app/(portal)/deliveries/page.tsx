'use client';

import { Truck, CheckCircle2, Clock, XCircle, RotateCcw } from 'lucide-react';
import { Card, CardContent, Badge } from '@water-supply-crm/ui';
import { useDeliveries } from '../../../features/deliveries/hooks/use-deliveries';
import { cn } from '@water-supply-crm/ui';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING:       { label: 'Pending',       color: 'bg-muted text-muted-foreground' },
  COMPLETED:     { label: 'Delivered',     color: 'bg-emerald-500/10 text-emerald-500' },
  EMPTY_ONLY:    { label: 'Empty Only',    color: 'bg-blue-500/10 text-blue-500' },
  NOT_AVAILABLE: { label: 'Unavailable',   color: 'bg-yellow-500/10 text-yellow-600' },
  RESCHEDULED:   { label: 'Rescheduled',   color: 'bg-orange-500/10 text-orange-500' },
  CANCELLED:     { label: 'Cancelled',     color: 'bg-destructive/10 text-destructive' },
};

export default function DeliveriesPage() {
  const { data, isLoading } = useDeliveries({ page: 1, limit: 30 });
  const deliveries = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Truck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Deliveries</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {meta?.total ?? 0} total records
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-accent/30 animate-pulse" />
          ))}
        </div>
      ) : deliveries.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Truck className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-bold text-muted-foreground">No deliveries yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Your delivery history will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d: any) => {
            const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG['PENDING'];
            return (
              <Card key={d.id} className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">
                        {new Date(d.date ?? d.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <Badge className={cn("text-[10px] px-2 py-0 rounded-full border-none font-bold", cfg.color)}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {d.product?.name ?? 'Product'} · Dropped: {d.filledDropped ?? 0} · Received: {d.emptyReceived ?? 0}
                    </p>
                  </div>
                  {d.cashCollected > 0 && (
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-sm text-emerald-500">₨ {Number(d.cashCollected).toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">collected</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
