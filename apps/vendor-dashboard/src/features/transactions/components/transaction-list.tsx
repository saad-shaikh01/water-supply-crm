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
  const { data, isLoading, page, setPage } = useTransactions(customerId);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const txData = (data as { data?: unknown[]; totalPages?: number } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; description?: string }>;
  const totalPages = txData?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-accent/30 border border-border/50 max-w-sm w-full focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search notes..." 
            className="bg-transparent border-none outline-none text-sm w-full placeholder:text-muted-foreground/50"
          />
        </div>
        
        {customerId && (
          <Button 
            onClick={() => setPaymentOpen(true)}
            className="rounded-full shadow-lg shadow-primary/20 flex items-center gap-2 font-bold"
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
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No transactions found in this period."
        columns={[
          { 
            key: 'date', 
            header: 'Date', 
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span className="text-xs font-medium">{new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            ) 
          },
          ...(customerId ? [] : [{ 
            key: 'customer', 
            header: 'Customer', 
            cell: (r: typeof rows[0]) => (
              <span className="font-bold text-sm">{r.customer?.name ?? '—'}</span>
            ) 
          }]),
          { 
            key: 'type', 
            header: 'Type', 
            cell: (r) => (
              <StatusBadge status={r.type} />
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
                  "font-mono font-bold text-sm flex items-center gap-1",
                  isPayment ? "text-emerald-500" : "text-destructive"
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
              <div className="flex items-center gap-2 text-muted-foreground max-w-[300px]">
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
