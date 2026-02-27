'use client';

import { Suspense } from 'react';
import { Receipt, Search, X } from 'lucide-react';
import { TransactionList } from '../../../features/transactions/components/transaction-list';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { Button, Input, cn } from '@water-supply-crm/ui';

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'DELIVERY', label: 'Deliveries' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
];

function TransactionsContent() {
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [dateFrom, setDateFrom] = useQueryState('dateFrom', parseAsString.withDefault(''));
  const [dateTo, setDateTo] = useQueryState('dateTo', parseAsString.withDefault(''));
  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const hasExtraFilters = Boolean(search || dateFrom || dateTo);

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
            onClick={() => {
              setTypeFilter(tab.value || null);
              setPage(1);
            }}
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

      <div className="rounded-3xl border border-border/50 bg-card/40 p-3 sm:p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value || null);
                setPage(1);
              }}
              placeholder="Search descriptions"
              className="rounded-2xl pl-9"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:w-auto">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value || null);
                setPage(1);
              }}
              className="rounded-2xl min-w-[10rem]"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value || null);
                setPage(1);
              }}
              className="rounded-2xl min-w-[10rem]"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch(null);
              setDateFrom(null);
              setDateTo(null);
              setPage(1);
            }}
            disabled={!hasExtraFilters}
            className="rounded-2xl font-bold gap-2"
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
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
