'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { PaymentForm } from './payment-form';
import { useTransactions } from '../hooks/use-transactions';

interface TransactionListProps {
  customerId?: string;
}

export function TransactionList({ customerId }: TransactionListProps) {
  const { data, isLoading, page } = useTransactions();
  const [paymentOpen, setPaymentOpen] = useState(false);

  const txData = (data as { data?: unknown[]; totalPages?: number } | undefined);
  const rows = (txData?.data ?? []) as Array<{ id: string; type: string; amount: number; createdAt: string; customer?: { name: string }; notes?: string }>;
  const totalPages = txData?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {customerId && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setPaymentOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Payment
          </Button>
        </div>
      )}
      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        emptyMessage="No transactions found"
        columns={[
          { key: 'date', header: 'Date', cell: (r) => new Date(r.createdAt).toLocaleDateString() },
          ...(customerId ? [] : [{ key: 'customer', header: 'Customer', cell: (r: typeof rows[0]) => r.customer?.name ?? '—' }]),
          { key: 'type', header: 'Type', cell: (r) => <StatusBadge status={r.type} /> },
          { key: 'amount', header: 'Amount', cell: (r) => `$${Number(r.amount).toFixed(2)}` },
          { key: 'notes', header: 'Notes', cell: (r) => r.notes ?? '—' },
        ]}
      />
      {customerId && (
        <PaymentForm open={paymentOpen} onOpenChange={setPaymentOpen} customerId={customerId} />
      )}
    </div>
  );
}
