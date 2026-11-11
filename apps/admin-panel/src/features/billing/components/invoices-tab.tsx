'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { VendorSelect } from '../../vendor-picker/vendor-select';
import { useInvoices, useIssueInvoice } from '../hooks/use-billing';
import { fmtDate, money } from '../lib/billing';
import type { Invoice } from '../api/billing.api';
import { CreateInvoiceDialog, InvoiceStatusBadge, RecordPaymentDialog, VoidInvoiceDialog } from './invoice-dialogs';

const KEYS = ['istatus', 'ivendor', 'ifrom', 'ito'] as const;

/** `YYYY-MM-DD` -> ISO bounds in PKT so "to" includes the whole day. */
const fromIso = (d: string) => (d ? `${d}T00:00:00+05:00` : '');
const toIso = (d: string) => (d ? `${d}T23:59:59+05:00` : '');

export function InvoicesTab() {
  const url = useUrlFilters(KEYS);
  const params = compactParams({
    status: url.values.istatus,
    vendorId: url.values.ivendor,
    from: fromIso(url.values.ifrom),
    to: toIso(url.values.ito),
    page: url.page,
    limit: url.limit,
  });
  const { data, isLoading, error, refetch } = useInvoices(params);
  const issue = useIssueInvoice();
  const [createOpen, setCreateOpen] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);

  const columns: DataTableColumn<Invoice>[] = [
    { key: 'number', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: 'vendor', header: 'Vendor', cell: (i) => i.vendor?.name ?? i.vendorId },
    { key: 'amount', header: 'Amount', cell: (i) => money(i.amount, i.currency) },
    { key: 'status', header: 'Status', cell: (i) => <InvoiceStatusBadge invoice={i} /> },
    { key: 'due', header: 'Due', cell: (i) => fmtDate(i.dueAt) },
    { key: 'paid', header: 'Paid on', cell: (i) => fmtDate(i.paidAt) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (i) => (
        <div className="flex justify-end gap-2">
          {i.status === 'DRAFT' && (
            <Button size="sm" variant="outline" aria-label={`Issue ${i.number}`} disabled={issue.isPending} onClick={() => issue.mutate(i.id)}>
              Issue
            </Button>
          )}
          {i.status === 'OPEN' && (
            <Button size="sm" aria-label={`Record payment for ${i.number}`} onClick={() => setPaying(i)}>
              Record payment
            </Button>
          )}
          {(i.status === 'DRAFT' || i.status === 'OPEN') && (
            <Button size="sm" variant="ghost" aria-label={`Void ${i.number}`} onClick={() => setVoiding(i)}>
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <NativeSelect aria-label="Filter by status" value={url.values.istatus} onChange={(e) => url.setFilters({ istatus: e.target.value })}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="OPEN">Open</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </NativeSelect>
        <div className="lg:col-span-2">
          <VendorSelect id="invoice-filter-vendor" label="Vendor" value={url.values.ivendor} onChange={(id) => url.setFilters({ ivendor: id })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invoice-from">From</Label>
          <Input id="invoice-from" type="date" value={url.values.ifrom} onChange={(e) => url.setFilters({ ifrom: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invoice-to">To</Label>
          <Input id="invoice-to" type="date" value={url.values.ito} onChange={(e) => url.setFilters({ ito: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Create invoice
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(i) => i.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={{ title: 'No invoices', description: 'Create an invoice or adjust the filters.' }}
        pagination={{ page: url.page, limit: url.limit, total: data?.meta?.total ?? 0, onPageChange: url.setPage, onLimitChange: url.setLimit }}
      />
      <CreateInvoiceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RecordPaymentDialog invoice={paying} onClose={() => setPaying(null)} />
      <VoidInvoiceDialog invoice={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}
