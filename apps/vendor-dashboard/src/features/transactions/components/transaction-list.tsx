'use client';

import { useState } from 'react';
import { Button, Badge } from '@water-supply-crm/ui';
import { Plus, FileText, Calendar, Wallet, X } from 'lucide-react';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { PaymentForm } from './payment-form';
import { useTransactions } from '../hooks/use-transactions';
import { cn } from '@water-supply-crm/ui';

const TRANSACTION_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'COLLECTION', label: 'Collection' },
];

interface TransactionListProps {
  customerId?: string;
}

import { Sheet, SheetContent, SheetHeader, SheetTitle, Label } from '@water-supply-crm/ui';
import { SlidersHorizontal } from 'lucide-react';

export function TransactionList({ customerId }: TransactionListProps) {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    type,
    setType,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  } = useTransactions(customerId);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const txData = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; description?: string }>;
  const total = txData?.meta?.total ?? 0;

  const activeFilterCount = [type, dateFrom, dateTo].filter(Boolean).length;

  function clearFilters() {
    setType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 w-full sm:flex sm:items-center sm:gap-2">
          {/* Search Placeholder if needed, but here we use types/dates */}
          <div className="hidden sm:flex items-center gap-2">
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="h-10 rounded-xl bg-background/50 border-border/50 text-sm text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
            >
              {TRANSACTION_TYPES.map((t) => (
                <option key={t.value} value={t.value} className="bg-background text-white">
                  {t.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="h-10 rounded-xl bg-background/50 border-border/50 text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
            />
            <span className="text-muted-foreground text-xs font-bold">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="h-10 rounded-xl bg-background/50 border-border/50 text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
            />
          </div>
          <div className="sm:hidden text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 ml-1">Transactions Filter</div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            className={cn(
              "rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0 flex-1 sm:flex-none sm:hidden",
              activeFilterCount > 0 && "border-primary text-primary"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
                {activeFilterCount}
              </Badge>
            )}
          </Button>

          {customerId && (
            <Button
              onClick={() => setPaymentOpen(true)}
              className="rounded-xl shadow-lg shadow-primary/20 flex items-center gap-2 font-bold h-9 sm:h-10 px-4 sm:px-6 shrink-0 flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4" />
              <span className="whitespace-nowrap">Record Payment</span>
            </Button>
          )}
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Transaction Type</Label>
              <select
                value={type}
                onChange={(e) => { setType(e.target.value); setPage(1); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
              >
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value} className="bg-background text-white">
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">From Date</Label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">To Date</Label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
              />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="border-t pt-4">
              <Button variant="ghost" className="w-full rounded-xl text-muted-foreground" onClick={() => { clearFilters(); setFiltersOpen(false); }}>
                <X className="h-4 w-4 mr-2" /> Clear All Filters
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
        emptyMessage="No transactions found in this period."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            ),
          },
          ...(customerId ? [] : [{
            key: 'customer',
            header: 'Customer',
            cell: (r: typeof rows[0]) => (
              <span className="font-bold text-sm text-white truncate max-w-[180px] block">{r.customer?.name ?? '—'}</span>
            ),
          }]),
          {
            key: 'type',
            header: 'Type',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={r.type} />
              </div>
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            cell: (r) => {
              const amount = Number(r.amount);
              const isPayment = amount < 0;
              return (
                <div className={cn(
                  'font-mono font-bold text-xs flex items-center gap-1 whitespace-nowrap',
                  isPayment ? 'text-emerald-400' : 'text-rose-400',
                )}>
                  {isPayment ? '-' : '+'} ₨ {Math.abs(amount).toLocaleString()}
                </div>
              );
            },
          },
          {
            key: 'notes',
            header: 'Description',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/60 max-w-[250px]">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="text-xs truncate italic">{r.description || 'No notes available'}</span>
              </div>
            ),
          },
        ]}
      />

      {customerId && (
        <PaymentForm open={paymentOpen} onOpenChange={setPaymentOpen} customerId={customerId} />
      )}
    </div>
  );
}
