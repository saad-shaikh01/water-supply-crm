'use client';

import { Suspense, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Badge } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useOrders, useApproveOrder, useRejectOrder } from '../../../features/orders/hooks/use-orders';
import { OrderRejectDialog } from '../../../features/orders/components/order-reject-dialog';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function OrdersContent() {
  const { data, isLoading, page, setPage, limit, setLimit, status, setStatus } = useOrders();
  const { mutate: approve, isPending: isApproving } = useApproveOrder();
  const { mutate: reject, isPending: isRejecting } = useRejectOrder();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.meta?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Orders"
        description="Review and manage extra delivery orders from customers."
      />

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => { setStatus(opt.value || null); setPage(1); }}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all border',
              status === opt.value
                ? 'bg-primary text-primary-foreground border-transparent shadow-lg shadow-primary/20'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No orders found."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r: any) => (
              <div>
                <p className="font-bold text-sm">{r.customer?.name}</p>
                <p className="text-[10px] text-muted-foreground">{r.customer?.phoneNumber}</p>
              </div>
            ),
          },
          {
            key: 'product',
            header: 'Product',
            cell: (r: any) => (
              <div>
                <p className="font-bold text-sm">{r.product?.name}</p>
                <p className="text-[10px] text-muted-foreground">× {r.quantity}</p>
              </div>
            ),
          },
          {
            key: 'note',
            header: 'Note',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">{r.note ?? '—'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r: any) => {
              if (r.status === 'REJECTED' && r.rejectionReason) {
                return (
                  <div>
                    <StatusBadge status={r.status} />
                    <p className="text-[10px] text-destructive mt-0.5">{r.rejectionReason}</p>
                  </div>
                );
              }
              return <StatusBadge status={r.status} />;
            },
          },
          {
            key: 'actions',
            header: '',
            width: '100px',
            cell: (r: any) =>
              r.status === 'PENDING' ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 rounded-full"
                    onClick={() => approve(r.id)}
                    disabled={isApproving}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-full"
                    onClick={() => { setSelectedOrderId(r.id); setRejectOpen(true); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />

      <OrderRejectDialog
        open={rejectOpen}
        onOpenChange={(v) => { setRejectOpen(v); if (!v) setSelectedOrderId(null); }}
        isPending={isRejecting}
        onConfirm={(reason) => {
          if (selectedOrderId) {
            reject({ id: selectedOrderId, rejectionReason: reason }, {
              onSuccess: () => { setRejectOpen(false); setSelectedOrderId(null); },
            });
          }
        }}
      />
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
