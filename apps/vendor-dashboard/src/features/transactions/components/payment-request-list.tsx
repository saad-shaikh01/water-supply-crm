'use client';

import { useState } from 'react';
import { Check, X, Eye, Calendar, SlidersHorizontal } from 'lucide-react';
import {
  Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label, Badge, Sheet, SheetContent, SheetHeader, SheetTitle
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { usePaymentRequests, useApproveRequest, useRejectRequest } from '../hooks/use-transactions';
import { transactionsApi } from '../api/transactions.api';
import { useAllCustomers } from '../../customers/hooks/use-customers';
import { cn } from '@water-supply-crm/ui';

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PAID', label: 'Paid' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const METHOD_OPTIONS = [
  { value: '', label: 'All Methods' },
  { value: 'RAAST_QR', label: 'Raast QR' },
  { value: 'MANUAL_RAAST', label: 'Manual Raast' },
  { value: 'MANUAL_JAZZCASH', label: 'JazzCash' },
  { value: 'MANUAL_EASYPAISA', label: 'Easypaisa' },
  { value: 'MANUAL_BANK', label: 'Bank Transfer' },
];

async function openScreenshot(requestId: string) {
  // Open a blank tab immediately inside the user-gesture handler, then
  // navigate it once the signed URL arrives (avoids popup-blocker issues).
  const win = window.open('', '_blank');
  try {
    const { data } = await transactionsApi.getScreenshotUrl(requestId);
    win?.location.assign(data.signedUrl);
  } catch {
    win?.close();
    toast.error('Could not load screenshot');
  }
}

export function PaymentRequestList() {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    status,
    setStatus,
    customerId,
    setCustomerId,
    method,
    setMethod,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  } = usePaymentRequests();
  const { mutate: approve, isPending: isApproving } = useApproveRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectRequest();
  const { data: customersData } = useAllCustomers();

  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const requests = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (requests?.data ?? []) as Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    createdAt: string;
    referenceNo?: string;
    customer?: { name: string; customerCode: string };
    screenshotPath?: string;
  }>;
  const total = requests?.meta?.total ?? 0;
  const customers = (((customersData as { data?: unknown[] } | undefined)?.data) ?? []) as Array<{
    id: string;
    name: string;
    customerCode?: string;
  }>;

  const activeFilterCount = [status, customerId, method, dateFrom || dateTo].filter(Boolean).length;

  const handleReject = () => {
    if (selectedRequest && rejectReason) {
      reject({ id: selectedRequest.id, reason: rejectReason }, {
        onSuccess: () => {
          setRejectOpen(false);
          setSelectedRequest(null);
          setRejectReason('');
        }
      });
    }
  };

  const resetPage = () => setPage(1);

  const clearAll = () => {
    setStatus(null);
    setCustomerId(null);
    setMethod(null);
    setDateFrom(null);
    setDateTo(null);
    resetPage();
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value || null); resetPage(); }}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border-border/50 text-sm text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[120px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-white">
                {opt.label}
              </option>
            ))}
          </select>
          <div className="sm:hidden text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Payment Requests</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            'rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0',
            activeFilterCount > 0 && 'border-primary text-primary'
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {status && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Status: {STATUS_OPTIONS.find((opt) => opt.value === status)?.label}
              <button onClick={() => { setStatus(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          {customerId && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Customer: {customers.find((c) => c.id === customerId)?.name || '...'}
              <button onClick={() => { setCustomerId(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          {method && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Method: {METHOD_OPTIONS.find((opt) => opt.value === method)?.label}
              <button onClick={() => { setMethod(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          {(dateFrom || dateTo) && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Date: {dateFrom || '...'} to {dateTo || '...'}
              <button onClick={() => { setDateFrom(null); setDateTo(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-white font-semibold underline-offset-4 hover:underline ml-1"
          >
            Clear All
          </button>
        </div>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6 overflow-y-auto max-h-[calc(100vh-180px)] px-1">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer</Label>
              <select
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value || null); resetPage(); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 appearance-none cursor-pointer"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id} className="bg-background text-white">
                    {c.name}{c.customerCode ? ` (${c.customerCode})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Method</Label>
              <select
                value={method}
                onChange={(e) => { setMethod(e.target.value || null); resetPage(); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 appearance-none cursor-pointer"
              >
                {METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-background text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Date Range</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => { setDateFrom(e.target.value || null); resetPage(); }}
                  className="h-10 rounded-xl bg-background/50 border-border text-sm"
                />
                <Input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => { setDateTo(e.target.value || null); resetPage(); }}
                  className="h-10 rounded-xl bg-background/50 border-border text-sm"
                />
              </div>
            </div>
          </div>
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
        emptyMessage="No payment requests found."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => (
              <div className="flex flex-col min-w-0 max-w-[180px]">
                <span className="font-bold text-sm text-white truncate">{r.customer?.name}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono truncate">{r.customer?.customerCode}</span>
              </div>
            )
          },
          {
            key: 'amount',
            header: 'Amount',
            cell: (r) => (
              <div className="font-mono font-bold text-xs text-emerald-400 whitespace-nowrap">
                ₨ {r.amount.toLocaleString()}
              </div>
            )
          },
          {
            key: 'method',
            header: 'Method',
            cell: (r) => (
              <Badge variant="outline" className="font-mono text-[9px] bg-white/5 border-white/10 text-white/60 px-1.5 py-0 rounded-md whitespace-nowrap">
                {r.method.replace('MANUAL_', '').replace('_', ' ')}
              </Badge>
            )
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={r.status} />
              </div>
            )
          },
          {
            key: 'actions',
            header: '',
            width: '100px',
            cell: (r) => (
              <div className="flex items-center gap-1 shrink-0">
                {r.status === 'PENDING' && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10 rounded-full"
                      onClick={() => approve(r.id)}
                      disabled={isApproving}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-rose-400 hover:bg-rose-500/10 rounded-full"
                      onClick={() => { setSelectedRequest(r); setRejectOpen(true); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {r.screenshotPath && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-indigo-400 hover:bg-indigo-500/10 rounded-full"
                    onClick={() => openScreenshot(r.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-destructive flex items-center gap-2">
              <X className="h-6 w-6" /> Reject Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for rejecting this payment of <span className="font-bold text-foreground">₨ {selectedRequest?.amount}</span> from <span className="font-bold text-foreground">{selectedRequest?.customer?.name}</span>.
            </p>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Rejection Reason</Label>
              <Input
                placeholder="e.g. Screenshot blurry, Amount mismatch"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isRejecting || !rejectReason}
              className="rounded-xl font-bold"
            >
              {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
