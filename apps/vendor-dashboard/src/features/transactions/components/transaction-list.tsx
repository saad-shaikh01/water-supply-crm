'use client';

import { useState } from 'react';
import { Button, Badge, Sheet, SheetContent, SheetHeader, SheetTitle, Label } from '@water-supply-crm/ui';
import { Plus, FileText, Calendar, Wallet, X, SlidersHorizontal, Search } from 'lucide-react';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { PaymentForm } from './payment-form';
import { useTransactions } from '../hooks/use-transactions';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAllCustomers } from '../../customers/hooks/use-customers';
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

export function TransactionList({ customerId: overrideCustomerId }: TransactionListProps) {
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    search,
    setSearch,
    customerId,
    setCustomerId,
    vanId,
    setVanId,
    type,
    setType,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  } = useTransactions(overrideCustomerId);

  const { data: vansData } = useAllVans();
  const { data: customersData } = useAllCustomers();
  
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const txData = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; description?: string }>;
  const total = txData?.meta?.total ?? 0;

  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string }>;
  const customers = ((customersData as any)?.data ?? []) as Array<{ id: string; name: string; customerCode: string }>;

  const activeFilterCount = [
    !overrideCustomerId && customerId,
    vanId,
    type,
    dateFrom || dateTo
  ].filter(Boolean).length;

  const resetPage = () => setPage(1);

  const clearAll = () => {
    setSearch(null);
    if (!overrideCustomerId) setCustomerId(null);
    setVanId(null);
    setType(null);
    setDateFrom(null);
    setDateTo(null);
    resetPage();
  };

  const handlePresetDate = (preset: 'today' | '7days' | 'month') => {
    const end = new Date();
    const start = new Date();
    if (preset === '7days') start.setDate(end.getDate() - 7);
    if (preset === 'month') start.setDate(1);
    
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    setDateFrom(formatDate(start));
    setDateTo(formatDate(end));
    resetPage();
  };

  return (
    <div className="space-y-4">
      {/* Primary filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 w-full">
          <SearchInput 
            placeholder="Search notes or customers..." 
            onBeforeChange={resetPage} 
          />
        </div>
        
        <div className="hidden sm:flex items-center gap-2">
          <select
            value={type || ''}
            onChange={(e) => { setType(e.target.value || null); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border-border/50 text-sm text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value} className="bg-background text-white">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            className={cn(
              "rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0 flex-1 sm:flex-none",
              activeFilterCount > 0 && "border-primary text-primary"
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

          {overrideCustomerId && (
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

      {/* Active chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {type && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Type: {TRANSACTION_TYPES.find(t => t.value === type)?.label}
              <button onClick={() => { setType(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          {!overrideCustomerId && customerId && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Customer: {customers.find(c => c.id === customerId)?.name || '...'}
              <button onClick={() => { setCustomerId(null); resetPage(); }}><X className="h-3 w-3" /></button>
            </Badge>
          )}
          {vanId && (
            <Badge variant="secondary" className="rounded-full pl-3 pr-1 py-1 gap-1 bg-primary/10 text-primary border-none">
              Van: {vans.find(v => v.id === vanId)?.plateNumber || '...'}
              <button onClick={() => { setVanId(null); resetPage(); }}><X className="h-3 w-3" /></button>
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

      {/* More Filters drawer */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6 overflow-y-auto max-h-[calc(100vh-180px)] px-1">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Transaction Type</Label>
              <select
                value={type || ''}
                onChange={(e) => { setType(e.target.value || null); resetPage(); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 appearance-none cursor-pointer"
              >
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value} className="bg-background text-white">
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {!overrideCustomerId && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer</Label>
                <select
                  value={customerId || ''}
                  onChange={(e) => { setCustomerId(e.target.value || null); resetPage(); }}
                  className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 appearance-none cursor-pointer"
                >
                  <option value="">All Customers</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id} className="bg-background text-white">
                      {c.name} ({c.customerCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Van / Delivery Fleet</Label>
              <select
                value={vanId || ''}
                onChange={(e) => { setVanId(e.target.value || null); resetPage(); }}
                className="w-full h-10 rounded-xl bg-background/50 border-border text-sm text-white px-3 appearance-none cursor-pointer"
              >
                <option value="">All Vans</option>
                {vans.map((v) => (
                  <option key={v.id} value={v.id} className="bg-background text-white">
                    {v.plateNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3 pt-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Date Range</Label>
              <div className="flex gap-2 flex-wrap mb-2">
                <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-full px-3" onClick={() => handlePresetDate('today')}>Today</Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-full px-3" onClick={() => handlePresetDate('7days')}>Last 7 Days</Button>
                <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-full px-3" onClick={() => handlePresetDate('month')}>This Month</Button>
              </div>
              <DateRangePicker className="w-full" />
            </div>
          </div>
          <div className="pt-4 border-t border-border mt-auto">
            <Button variant="ghost" className="w-full rounded-xl text-muted-foreground" onClick={clearAll}>
              <X className="h-4 w-4 mr-2" /> Clear All Filters
            </Button>
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
          ...(overrideCustomerId ? [] : [{
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

      {overrideCustomerId && (overrideCustomerId !== '') && (
        <PaymentForm open={paymentOpen} onOpenChange={setPaymentOpen} customerId={overrideCustomerId} />
      )}
    </div>
  );
}
