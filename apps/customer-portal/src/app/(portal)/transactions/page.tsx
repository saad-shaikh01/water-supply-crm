'use client';

import { Suspense } from 'react';
import { Receipt } from 'lucide-react';
import { TransactionList } from '../../../features/transactions/components/transaction-list';
import { parseAsString, useQueryState } from 'nuqs';
import { cn } from '@water-supply-crm/ui';

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'DELIVERY', label: 'Deliveries' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
];

function TransactionsContent() {
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault(''));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Receipt className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Transaction History</h1>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest text-[10px]">Full Financial Ledger</p>
        </div>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setTypeFilter(tab.value || null)}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-bold transition-all',
              typeFilter === tab.value
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                : 'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <TransactionList typeFilter={typeFilter || undefined} />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <TransactionsContent />
    </Suspense>
  );
}
