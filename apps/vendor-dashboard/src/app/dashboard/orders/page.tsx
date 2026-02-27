'use client';

import { Suspense, useState } from 'react';
import { Check, Truck, X } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import {
  useOrders,
  useApproveOrder,
  useRejectOrder,
  useSaveDispatchPlan,
  useDispatchOrderNow,
  useInsertOrderIntoSheet,
} from '../../../features/orders/hooks/use-orders';
import { OrderRejectDialog } from '../../../features/orders/components/order-reject-dialog';
import { OrderDispatchDrawer } from '../../../features/orders/components/order-dispatch-drawer';

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
  const { mutate: saveDispatchPlan, isPending: isSavingPlan } = useSaveDispatchPlan();
  const { mutate: dispatchNow, isPending: isDispatchingNow } = useDispatchOrderNow();
  const { mutate: insertIntoSheet, isPending: isInsertingIntoSheet } = useInsertOrderIntoSheet();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<any>(null);

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.meta?.total ?? 0;

  const formatDate = (date?: string) =>
    date
      ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : '-';

  const formatDateTime = (date?: string) =>
    date
      ? new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '-';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Orders"
        description="Review approvals separately from dispatch planning for extra delivery orders."
      />

      <div className="space-y-3">
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
        <div className="flex flex-wrap gap-3 items-center">
          <SearchInput
            placeholder="Search customer, phone, or product..."
            onBeforeChange={() => setPage(1)}
          />
          <DateRangePicker className="w-[220px]" />
        </div>
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
                {formatDate(r.createdAt)}
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
                <p className="text-[10px] text-muted-foreground">x {r.quantity}</p>
              </div>
            ),
          },
          {
            key: 'dispatch',
            header: 'Dispatch',
            cell: (r: any) => (
              <div>
                <StatusBadge status={r.dispatchStatus ?? 'UNPLANNED'} />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {r.targetDate ? `${formatDate(r.targetDate)}${r.timeWindow ? ` | ${r.timeWindow}` : ''}` : 'No plan saved'}
                </p>
              </div>
            ),
          },
          {
            key: 'note',
            header: 'Ops Notes',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">{r.dispatchNotes ?? r.note ?? '-'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Approval',
            cell: (r: any) => {
              if (r.status === 'REJECTED' && r.rejectionReason) {
                return (
                  <div>
                    <StatusBadge status={r.status} />
                    <p className="text-[10px] text-destructive mt-0.5">{r.rejectionReason}</p>
                  </div>
                );
              }

              if (r.status === 'APPROVED' && r.reviewedAt) {
                return (
                  <div>
                    <StatusBadge status={r.status} />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(r.reviewedAt)}</p>
                  </div>
                );
              }

              return <StatusBadge status={r.status} />;
            },
          },
          {
            key: 'actions',
            header: '',
            width: '160px',
            cell: (r: any) => {
              if (r.status === 'PENDING') {
                return (
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
                );
              }

              if (r.status === 'APPROVED') {
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl h-8 text-xs font-bold gap-1.5"
                    onClick={() => setDispatchOrder(r)}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    {r.dispatchStatus === 'UNPLANNED' ? 'Plan' : 'Edit Plan'}
                  </Button>
                );
              }

              return null;
            },
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

      <OrderDispatchDrawer
        order={dispatchOrder}
        open={!!dispatchOrder}
        onOpenChange={(open) => { if (!open) setDispatchOrder(null); }}
        isSaving={isSavingPlan || isInsertingIntoSheet}
        isDispatching={isDispatchingNow}
        onSave={(form) => {
          if (!dispatchOrder) return;
          const { targetSheetId, ...planData } = form;
          saveDispatchPlan({
            id: dispatchOrder.id,
            data: planData,
            hasExistingPlan: dispatchOrder.dispatchStatus && dispatchOrder.dispatchStatus !== 'UNPLANNED',
          }, {
            onSuccess: () => {
              if (planData.dispatchMode === 'INSERT_IN_OPEN_SHEET' && targetSheetId) {
                insertIntoSheet(
                  { sheetId: targetSheetId, orderId: dispatchOrder.id },
                  { onSuccess: () => setDispatchOrder(null) },
                );
                return;
              }

              setDispatchOrder(null);
            },
          });
        }}
        onDispatchNow={() => {
          if (!dispatchOrder) return;
          dispatchNow(dispatchOrder.id, {
            onSuccess: () => setDispatchOrder(null),
          });
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
