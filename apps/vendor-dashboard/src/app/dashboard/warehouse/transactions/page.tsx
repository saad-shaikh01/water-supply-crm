'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@water-supply-crm/ui';
import { PageHeader } from '../../../../components/shared/page-header';
import { DataTable } from '../../../../components/shared/data-table';
import { TransactionTypeBadge } from '../../../../features/warehouse/components/transaction-type-badge';
import { useWarehouseTransactions } from '../../../../features/warehouse/hooks/use-warehouse';
import { productsApi } from '../../../../features/products/api/products.api';

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'OPENING_BALANCE', label: 'Opening Balance' },
  { value: 'FILL_IN', label: 'Fill In' },
  { value: 'REFILL', label: 'Refill' },
  { value: 'LOAD_OUT', label: 'Load Out' },
  { value: 'CHECK_IN_FILLED', label: 'Check-In Filled' },
  { value: 'CHECK_IN_EMPTY', label: 'Check-In Empty' },
  { value: 'CHECK_IN_DAMAGED', label: 'Check-In Damaged' },
  { value: 'CHECK_IN_LEAKED', label: 'Check-In Leaked' },
  { value: 'MARK_DAMAGED', label: 'Mark Damaged' },
  { value: 'MARK_LEAKED', label: 'Mark Leaked' },
  { value: 'SEND_REPAIR', label: 'Send Repair' },
  { value: 'RETURN_REPAIR', label: 'Return Repair' },
  { value: 'WRITE_OFF', label: 'Write Off' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'DISCREPANCY_ADJUST', label: 'Discrepancy Adj.' },
];

function DeltaCell({ label, value, color }: { label: string; value: number; color: string }) {
  if (value === 0) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${color}`}>
      {value > 0 ? '+' : ''}{value} {label}
    </span>
  );
}

export default function WarehouseTransactionsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [productId, setProductId] = useState('');
  const [type, setType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params = {
    page,
    limit,
    productId: productId || undefined,
    type: type || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = useWarehouseTransactions(params);

  const { data: productsData } = useQuery({
    queryKey: ['warehouse-tx-products-select'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  const rows = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse Transactions"
        description="Full audit log of all warehouse stock movements."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-4 rounded-2xl border border-border bg-card/30">
        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Product</Label>
          <select
            value={productId}
            onChange={(e) => { setProductId(e.target.value); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 min-w-[150px]"
          >
            <option value="" className="bg-background text-foreground dark:text-white">All Products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">{p.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Type</Label>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 min-w-[160px]"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">From Date</Label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 w-36"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">To Date</Label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 w-36"
          />
        </div>
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No transactions found."
        columns={[
          {
            key: 'createdAt',
            header: 'Date / Time',
            cell: (r: any) => (
              <div className="flex flex-col min-w-[100px]">
                <span className="text-xs font-bold text-foreground dark:text-white tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-[10px] text-muted-foreground/60 font-medium">
                  {new Date(r.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ),
          },
          {
            key: 'product',
            header: 'Product',
            cell: (r: any) => (
              <span className="text-sm font-bold text-foreground dark:text-white">{r.product?.name ?? '—'}</span>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            cell: (r: any) => <TransactionTypeBadge type={r.type} />,
          },
          {
            key: 'changes',
            header: 'Changes',
            cell: (r: any) => (
              <div className="flex flex-col gap-0.5">
                <DeltaCell label="filled" value={r.filledDelta} color={r.filledDelta > 0 ? 'text-blue-500' : 'text-rose-500'} />
                <DeltaCell label="empty" value={r.emptyDelta} color={r.emptyDelta > 0 ? 'text-muted-foreground' : 'text-rose-500'} />
                <DeltaCell label="damaged" value={r.damagedDelta} color={r.damagedDelta > 0 ? 'text-orange-500' : 'text-emerald-500'} />
                <DeltaCell label="leaked" value={r.leakedDelta} color={r.leakedDelta > 0 ? 'text-red-500' : 'text-emerald-500'} />
                <DeltaCell label="repair" value={r.repairDelta} color={r.repairDelta > 0 ? 'text-purple-500' : 'text-emerald-500'} />
              </div>
            ),
          },
          {
            key: 'notes',
            header: 'Notes',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground max-w-[200px] truncate block">
                {r.notes ?? (r.repairBatch ? `Shop: ${r.repairBatch.shopName}` : '—')}
              </span>
            ),
          },
          {
            key: 'createdBy',
            header: 'Created By',
            cell: (r: any) => (
              <div className="flex flex-col min-w-[100px]">
                <span className="text-xs font-bold text-foreground dark:text-white">{r.createdBy?.name ?? '—'}</span>
                {r.createdBy?.role && (
                  <span className="text-[10px] text-muted-foreground/60 capitalize">{r.createdBy.role.toLowerCase().replace('_', ' ')}</span>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
