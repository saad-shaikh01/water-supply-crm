'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
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

  const txData = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; description?: string }>;
  const total = txData?.meta?.total ?? 0;

  const hasFilters = !!(type || dateFrom || dateTo);

  function clearFilters() {
    setType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Type filter */}
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="h-9 rounded-xl bg-white/[0.04] border border-border text-sm text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value} className="bg-background text-white">
                {t.label}
              </option>
            ))}
          </select>

          {/* Date from */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-9 rounded-xl bg-white/[0.04] border border-border text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
          />

          {/* Date to */}
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-9 rounded-xl bg-white/[0.04] border border-border text-sm text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
          />

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 h-9 px-3 rounded-xl text-xs text-muted-foreground hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {customerId && (
          <Button
            onClick={() => setPaymentOpen(true)}
            className="rounded-full shadow-lg shadow-primary/20 flex items-center gap-2 font-bold h-10 px-6 shrink-0"
          >
            <Plus className="h-4 w-4" />
            Record Payment
          </Button>
        )}
      </div>

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
