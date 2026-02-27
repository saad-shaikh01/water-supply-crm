'use client';

import { useState } from 'react';
import { Button, Input, Badge } from '@water-supply-crm/ui';
import { Plus, Search, FileText, Calendar, Wallet } from 'lucide-react';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { PaymentForm } from './payment-form';
import { useTransactions } from '../hooks/use-transactions';
import { cn } from '@water-supply-crm/ui';

interface TransactionListProps {
  customerId?: string;
}

export function TransactionList({ customerId }: TransactionListProps) {
  const { data, isLoading, page, setPage, limit, setLimit } = useTransactions(customerId);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const txData = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; description?: string }>;
  const total = txData?.meta?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex-1 w-full max-w-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.02] border border-border focus-within:ring-4 focus-within:ring-primary/10 transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search notes..." 
              className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-muted-foreground/50 font-medium"
            />
          </div>
        </div>
        
        {customerId && (
          <Button 
            onClick={() => setPaymentOpen(true)}
            className="rounded-full shadow-lg shadow-primary/20 flex items-center gap-2 font-bold h-10 px-6"
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
                <span className="text-xs font-medium tabular-nums">{new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            ) 
          },
          ...(customerId ? [] : [{ 
            key: 'customer', 
            header: 'Customer', 
            cell: (r: typeof rows[0]) => (
              <span className="font-bold text-sm text-white truncate max-w-[180px] block">{r.customer?.name ?? '—'}</span>
            ) 
          }]),
          { 
            key: 'type', 
            header: 'Type', 
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={r.type} />
              </div>
            ) 
          },
          { 
            key: 'amount', 
            header: 'Amount', 
            cell: (r) => {
              const amount = Number(r.amount);
              const isPayment = amount < 0; // Negative means money received
              return (
                <div className={cn(
                  "font-mono font-bold text-xs flex items-center gap-1 whitespace-nowrap",
                  isPayment ? "text-emerald-400" : "text-rose-400"
                )}>
                  {isPayment ? '-' : '+'} ₨ {Math.abs(amount).toLocaleString()}
                </div>
              );
            } 
          },
          { 
            key: 'notes', 
            header: 'Description', 
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/60 max-w-[250px]">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="text-xs truncate italic">{r.description || 'No notes available'}</span>
              </div>
            ) 
          },
        ]}
      />
      {customerId && (
        <PaymentForm open={paymentOpen} onOpenChange={setPaymentOpen} customerId={customerId} />
      )}
    </div>
  );
}
