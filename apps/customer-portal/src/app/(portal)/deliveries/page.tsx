'use client';

import { Suspense, useMemo } from 'react';
import { Truck, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Card, CardContent, Badge, Button } from '@water-supply-crm/ui';
import { useDeliveries } from '../../../features/deliveries/hooks/use-deliveries';
import { cn } from '@water-supply-crm/ui';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING:       { label: 'Pending',     color: 'bg-muted text-muted-foreground' },
  COMPLETED:     { label: 'Delivered',   color: 'bg-emerald-500/10 text-emerald-500' },
  EMPTY_ONLY:    { label: 'Empty Only',  color: 'bg-blue-500/10 text-blue-500' },
  NOT_AVAILABLE: { label: 'Unavailable', color: 'bg-yellow-500/10 text-yellow-600' },
  RESCHEDULED:   { label: 'Rescheduled', color: 'bg-orange-500/10 text-orange-500' },
  CANCELLED:     { label: 'Cancelled',   color: 'bg-destructive/10 text-destructive' },
};

const FAILURE_LABELS: Record<string, string> = {
  CUSTOMER_NOT_HOME:       'Not Home',
  CUSTOMER_NOT_ANSWERING:  'Not Answering',
  CUSTOMER_REFUSED:        'Refused Delivery',
  ADDRESS_NOT_FOUND:       'Address Not Found',
  EMPTY_NOT_READY:         'Empty Not Ready',
  OTHER:                   'Other',
};

// Build month options: current + past 5
function buildMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
    opts.push({ value, label });
  }
  return opts;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function DeliveriesContent() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [month, setMonth] = useQueryState('month', parseAsString.withDefault(''));

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  // Compute date range from selected month
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0); // last day of month
    dateFrom = formatLocalDate(from);
    dateTo = formatLocalDate(to);
  }

  const { data, isLoading } = useDeliveries({ page, limit: 20, dateFrom, dateTo });
  const deliveries = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;
  const totalPages = meta ? Math.ceil(meta.total / 20) : 1;

  // Stats
  const delivered = deliveries.filter((d: any) =>
    d.status === 'COMPLETED' || d.status === 'EMPTY_ONLY'
  ).length;
  const successRate = deliveries.length > 0
    ? Math.round((delivered / deliveries.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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

        {/* Month picker */}
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value || null); setPage(1); }}
          className="h-10 rounded-xl border border-border/60 bg-card/50 px-3 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 backdrop-blur-sm"
        >
          <option value="">All Time</option>
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Stats strip */}
      {!isLoading && deliveries.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'On Page', value: deliveries.length, color: 'text-foreground' },
            { label: 'Delivered', value: delivered, color: 'text-emerald-500' },
            { label: 'Success Rate', value: `${successRate}%`, color: 'text-primary' },
          ].map((s) => (
            <Card key={s.label} className="rounded-2xl border-border/50 bg-card/50">
              <CardContent className="p-3 text-center">
                <p className={cn('text-xl font-black font-mono', s.color)}>{s.value}</p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
            <p className="font-bold text-muted-foreground">No deliveries found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {month ? 'No deliveries for the selected month' : 'Your delivery history will appear here'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d: any) => {
            const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG['PENDING'];
            const failureLabel = d.failureCategory ? FAILURE_LABELS[d.failureCategory] ?? d.failureCategory : null;
            const showFailure = failureLabel && ['NOT_AVAILABLE', 'RESCHEDULED', 'CANCELLED'].includes(d.status);
            return (
              <Card key={d.id} className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">
                        {new Date(d.dailySheet?.date ?? d.createdAt).toLocaleDateString('en-PK', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                      <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', cfg.color)}>
                        {cfg.label}
                      </Badge>
                      {showFailure && (
                        <Badge className="text-[10px] px-2 py-0 rounded-full border-none font-bold bg-amber-500/10 text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-2.5 w-2.5" />
                          {failureLabel}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {d.product?.name ?? 'Product'} · Dropped: {d.filledDropped ?? 0} · Received: {d.emptyReceived ?? 0}
                    </p>
                  </div>
                  {d.cashCollected > 0 && (
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-sm text-emerald-500">
                        ₨ {Number(d.cashCollected).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">collected</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm font-bold text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DeliveriesPage() {
  return (
    <Suspense fallback={<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-20 rounded-2xl bg-accent/30 animate-pulse"/>)}</div>}>
      <DeliveriesContent />
    </Suspense>
  );
}
