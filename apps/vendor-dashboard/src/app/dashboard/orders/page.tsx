'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Check, SlidersHorizontal, Truck, X } from 'lucide-react';
import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { customersApi } from '../../../features/customers/api/customers.api';
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
import { productsApi } from '../../../features/products/api/products.api';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function OrdersContent() {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    status,
    setStatus,
    search,
    setSearch,
    customerId,
    setCustomerId,
    productId,
    setProductId,
    from,
    setFrom,
    to,
    setTo,
  } = useOrders();
  const { mutate: approve, isPending: isApproving } = useApproveOrder();
  const { mutate: reject, isPending: isRejecting } = useRejectOrder();
  const { mutate: saveDispatchPlan, isPending: isSavingPlan } = useSaveDispatchPlan();
  const { mutate: dispatchNow, isPending: isDispatchingNow } = useDispatchOrderNow();
  const { mutate: insertIntoSheet, isPending: isInsertingIntoSheet } = useInsertOrderIntoSheet();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState<any>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const previousDateRange = useRef(`${from}|${to}`);

  const { data: customerOptionsData } = useQuery({
    queryKey: ['order-filter-customers'],
    queryFn: () => customersApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });
  const { data: productOptionsData } = useQuery({
    queryKey: ['order-filter-products'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.meta?.total ?? 0;
  const customers = ((customerOptionsData as { data?: Array<{ id: string; name: string; phoneNumber?: string }> } | undefined)?.data ?? []);
  const products = ((productOptionsData as { data?: Array<{ id: string; name: string }> } | undefined)?.data ?? []);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const selectedProduct = products.find((product) => product.id === productId);
  const statusLabel = STATUS_OPTIONS.find((opt) => opt.value === status)?.label ?? 'All';
  const activeFilterCount = [customerId, productId, from || to].filter(Boolean).length;

  const formatDate = (date?: string) =>
    date
      ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : '-';

  const formatDateTime = (date?: string) =>
    date
      ? new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '-';

  const formatDateLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  useEffect(() => {
    const nextRange = `${from}|${to}`;
    if (previousDateRange.current !== nextRange) {
      previousDateRange.current = nextRange;
      setPage(1);
    }
  }, [from, to, setPage]);

  const activeChips = [
    status ? { label: `Status: ${statusLabel}`, clear: () => { setPage(1); setStatus(null); } } : null,
    search ? { label: `Search: ${search}`, clear: () => { setPage(1); setSearch(null); } } : null,
    customerId
      ? {
          label: `Customer: ${selectedCustomer?.name ?? 'Selected customer'}`,
          clear: () => { setPage(1); setCustomerId(null); },
        }
      : null,
    productId
      ? {
          label: `Product: ${selectedProduct?.name ?? 'Selected product'}`,
          clear: () => { setPage(1); setProductId(null); },
        }
      : null,
    (from || to)
      ? {
          label: `Date: ${from ? formatDateLabel(from) : '...'} to ${to ? formatDateLabel(to) : '...'}`,
          clear: () => { setPage(1); setFrom(null); setTo(null); },
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAdvancedFilters = () => {
    setPage(1);
    setCustomerId(null);
    setProductId(null);
    setFrom(null);
    setTo(null);
  };

  const clearAll = () => {
    setPage(1);
    setStatus(null);
    setSearch(null);
    setCustomerId(null);
    setProductId(null);
    setFrom(null);
    setTo(null);
  };

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            className={cn(
              'rounded-xl h-10 px-4 gap-2 font-semibold shrink-0',
              activeFilterCount > 0 && 'border-primary text-primary',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            More Filters
            {activeFilterCount > 0 && (
              <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            {activeChips.map((chip) => (
              <button
                key={chip.label}
                onClick={chip.clear}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            ))}
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border/50">
          <SheetHeader className="pb-6 border-b">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> More Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer</Label>
              <Select
                value={customerId || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setCustomerId(value === 'all' ? null : value);
                }}
              >
                <SelectTrigger className="rounded-xl bg-background/50 border-border/50 h-10">
                  <SelectValue placeholder="All Customers" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  <SelectItem value="all">All Customers</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</Label>
              <Select
                value={productId || 'all'}
                onValueChange={(value) => {
                  setPage(1);
                  setProductId(value === 'all' ? null : value);
                }}
              >
                <SelectTrigger className="rounded-xl bg-background/50 border-border/50 h-10">
                  <SelectValue placeholder="All Products" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  <SelectItem value="all">All Products</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Created Date</Label>
              <DateRangePicker className="w-full" />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="border-t pt-4">
              <Button
                variant="ghost"
                className="w-full rounded-xl text-muted-foreground"
                onClick={() => {
                  clearAdvancedFilters();
                  setFiltersOpen(false);
                }}
              >
                <X className="h-4 w-4 mr-2" /> Clear Drawer Filters
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

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
            key: 'preferredDate',
            header: 'Preferred Date',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">{formatDate(r.preferredDate)}</span>
            ),
          },
          {
            key: 'reviewedAt',
            header: 'Reviewed At',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">{formatDateTime(r.reviewedAt)}</span>
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
