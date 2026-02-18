'use client';

import { useState } from 'react';
import { CreditCard, Clock, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { Card, CardContent, Badge } from '@water-supply-crm/ui';
import { usePaymentHistory } from '../../../features/payments/hooks/use-payments';
import { cn } from '@water-supply-crm/ui';

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  PENDING:    { label: 'Pending',    icon: Clock,        color: 'bg-yellow-500/10 text-yellow-600' },
  PROCESSING: { label: 'Processing', icon: Clock,        color: 'bg-blue-500/10 text-blue-500' },
  PAID:       { label: 'Paid',       icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-500' },
  APPROVED:   { label: 'Approved',   icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-500' },
  REJECTED:   { label: 'Rejected',   icon: XCircle,      color: 'bg-destructive/10 text-destructive' },
  EXPIRED:    { label: 'Expired',    icon: Ban,          color: 'bg-muted text-muted-foreground' },
};

export default function PaymentsPage() {
  const [page] = useState(1);
  const { data, isLoading } = usePaymentHistory({ page, limit: 20 });
  const payments = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <CreditCard className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Payments</h1>
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
      ) : payments.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-bold text-muted-foreground">No payments yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Your payment history will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((p: any) => {
            const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG['PENDING'];
            const Icon = cfg.icon;
            return (
              <Card key={p.id} className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", cfg.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{p.method?.replace(/_/g, ' ') ?? 'Payment'}</span>
                      <Badge className={cn("text-[10px] px-2 py-0 rounded-full border-none font-bold", cfg.color)}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {p.referenceNo ? `Ref: ${p.referenceNo} · ` : ''}{new Date(p.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black font-mono text-sm">₨ {Number(p.amount).toLocaleString()}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
