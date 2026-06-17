'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { Button, Badge, Label } from '@water-supply-crm/ui';
import { PageHeader } from '../../../../components/shared/page-header';
import { DataTable } from '../../../../components/shared/data-table';
import { SendRepairDialog } from '../../../../features/warehouse/components/dialogs/send-repair-dialog';
import { ReturnRepairDialog } from '../../../../features/warehouse/components/dialogs/return-repair-dialog';
import { useRepairBatches } from '../../../../features/warehouse/hooks/use-warehouse';
import type { RepairBatch } from '../../../../features/warehouse/api/warehouse.api';
import { productsApi } from '../../../../features/products/api/products.api';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_RETURNED', label: 'Partially Returned' },
  { value: 'COMPLETED', label: 'Completed' },
];

const STATUS_BADGE: Record<string, string> = {
  SENT: 'bg-purple-500/10 text-purple-500 border border-purple-500/20',
  PARTIALLY_RETURNED: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
  COMPLETED: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
};

function RepairStatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-muted text-muted-foreground border border-border/40';
  const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

export default function RepairsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [returnBatch, setReturnBatch] = useState<RepairBatch | null>(null);

  const params = {
    page,
    limit,
    productId: productId || undefined,
    status: status || undefined,
  };

  const { data, isLoading } = useRepairBatches(params);

  const { data: productsData } = useQuery({
    queryKey: ['warehouse-repairs-products-select'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  const rows: RepairBatch[] = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repair Batches"
        description="Track bottles sent out for repair and manage returns."
        action={
          <Button
            onClick={() => setSendOpen(true)}
            className="rounded-xl font-bold gap-2"
          >
            <Wrench className="h-4 w-4" /> Send for Repair
          </Button>
        }
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
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); resetPage(); }}
            className="h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 min-w-[160px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">{opt.label}</option>
            ))}
          </select>
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
        emptyMessage="No repair batches found."
        columns={[
          {
            key: 'sentAt',
            header: 'Date Sent',
            cell: (r: any) => (
              <div className="flex flex-col min-w-[90px]">
                <span className="text-xs font-bold text-foreground dark:text-white tabular-nums">
                  {new Date(r.sentAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
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
            key: 'shopName',
            header: 'Shop Name',
            cell: (r: any) => (
              <span className="text-sm font-medium text-foreground dark:text-white">{r.shopName}</span>
            ),
          },
          {
            key: 'bottlesSent',
            header: 'Sent',
            cell: (r: any) => (
              <span className="font-mono font-black text-foreground dark:text-white">{r.bottlesSent}</span>
            ),
          },
          {
            key: 'bottlesReturned',
            header: 'Returned',
            cell: (r: any) => (
              <span className="font-mono font-black text-emerald-500">{r.bottlesReturned}</span>
            ),
          },
          {
            key: 'bottlesWrittenOff',
            header: 'Written Off',
            cell: (r: any) => (
              <span className={`font-mono font-black ${r.bottlesWrittenOff > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {r.bottlesWrittenOff}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r: any) => <RepairStatusBadge status={r.status} />,
          },
          {
            key: 'returnedAt',
            header: 'Date Returned',
            cell: (r: any) => (
              <span className="text-xs text-muted-foreground">
                {r.returnedAt
                  ? new Date(r.returnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: '90px',
            cell: (r: any) => {
              if (r.status === 'COMPLETED') return null;
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl h-8 text-xs font-bold gap-1.5 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => setReturnBatch(r)}
                >
                  Return
                </Button>
              );
            },
          },
        ]}
      />

      <SendRepairDialog open={sendOpen} onOpenChange={setSendOpen} products={products} />
      <ReturnRepairDialog
        open={!!returnBatch}
        onOpenChange={(o) => { if (!o) setReturnBatch(null); }}
        batch={returnBatch}
      />
    </div>
  );
}
