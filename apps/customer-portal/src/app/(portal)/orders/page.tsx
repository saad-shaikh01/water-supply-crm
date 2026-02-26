'use client';

import { Suspense, useState } from 'react';
import { ShoppingCart, Plus, ChevronLeft, ChevronRight, X, Clock, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { Card, CardContent, Badge, Button } from '@water-supply-crm/ui';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { cn } from '@water-supply-crm/ui';
import { useOrders, useCancelOrder } from '../../../features/orders/hooks/use-orders';
import { PlaceOrderDialog } from '../../../features/orders/components/place-order-dialog';
import { ListEmptyState, ListErrorState, ListLoadingState } from '../../../components/shared/list-states';

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  PENDING:   { label: 'Pending',   icon: Clock,        color: 'bg-amber-500/10 text-amber-600' },
  APPROVED:  { label: 'Approved',  icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-600' },
  REJECTED:  { label: 'Rejected',  icon: XCircle,      color: 'bg-destructive/10 text-destructive' },
  CANCELLED: { label: 'Cancelled', icon: Ban,          color: 'bg-muted text-muted-foreground' },
};

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function OrdersContent() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useOrders({ page, limit: 20, status: status || undefined });
  const { mutate: cancelOrder, isPending: isCancelling } = useCancelOrder();

  const orders = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;
  const totalPages = meta ? Math.ceil(meta.total / 20) : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">My Orders</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {meta?.total ?? 0} total orders
            </p>
          </div>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="rounded-2xl font-bold gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all"
        >
          <Plus className="h-4 w-4" />
          Place Order
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter.value || 'ALL'}
            onClick={() => {
              setStatus(filter.value || null);
              setPage(1);
            }}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all',
              status === filter.value
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                : 'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <ListLoadingState rows={3} />
      ) : isError ? (
        <ListErrorState
          icon={ShoppingCart}
          title="Failed to load orders"
          description="Please retry to fetch your latest order statuses."
          onRetry={() => refetch()}
        />
      ) : orders.length === 0 ? (
        <ListEmptyState
          icon={ShoppingCart}
          title="No orders yet"
          description="Place an order to request extra delivery."
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => {
            const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG['PENDING'];
            const Icon = cfg.icon;
            return (
              <Card key={order.id} className="bg-card/50 backdrop-blur-sm border-border/50">
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5', cfg.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">
                        {order.product?.name ?? 'Product'} × {order.quantity}
                      </span>
                      <Badge className={cn('text-[10px] px-2 py-0 rounded-full border-none font-bold', cfg.color)}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {order.preferredDate && ` · Preferred: ${new Date(order.preferredDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}`}
                    </p>
                    {order.note && (
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5">Note: {order.note}</p>
                    )}
                    {order.status === 'REJECTED' && order.rejectionReason && (
                      <p className="text-[11px] font-bold text-destructive mt-0.5">
                        Reason: {order.rejectionReason}
                      </p>
                    )}
                  </div>
                  {order.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      disabled={isCancelling}
                      onClick={() => cancelOrder(order.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
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
          <span className="text-sm font-bold text-muted-foreground">{page} / {totalPages}</span>
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

      <PlaceOrderDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <OrdersContent />
    </Suspense>
  );
}
