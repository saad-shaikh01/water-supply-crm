'use client';

import { useState } from 'react';
import { Button, Badge } from '@water-supply-crm/ui';
import { Eraser, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useVendors, useDeleteVendor, useSuspendVendor, useUnsuspendVendor } from '../hooks/use-vendors';
import { VendorForm } from './vendor-form';
import { WipeVendorDialog } from './wipe-vendor-dialog';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';

interface VendorRow {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  _counts?: { customers?: number; drivers?: number };
  createdAt?: string;
}

export function VendorList({ onAddVendor }: { onAddVendor?: () => void } = {}) {
  const { data, isLoading, error, refetch, page, setPage, limit, setLimit } = useVendors();
  const { mutate: deleteVendor } = useDeleteVendor();
  const { mutate: suspendVendor, isPending: isSuspending } = useSuspendVendor();
  const { mutate: unsuspendVendor, isPending: isUnsuspending } = useUnsuspendVendor();

  const [editTarget, setEditTarget] = useState<Record<string, unknown> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);
  const [wipeTarget, setWipeTarget] = useState<{ id: string; name: string; slug: string; isActive?: boolean } | null>(null);

  const response = data as { data?: unknown[]; meta?: { total: number } } | undefined;
  const vendors = (response?.data ?? []) as VendorRow[];
  const total = response?.meta?.total ?? 0;

  const columns: DataTableColumn<VendorRow>[] = [
    { key: 'name', header: 'Vendor', className: 'font-medium', cell: (v) => v.name },
    { key: 'slug', header: 'Slug', cell: (v) => <span className="text-muted-foreground font-mono text-xs">{v.slug}</span> },
    { key: 'customers', header: 'Customers', cell: (v) => v._counts?.customers ?? '—' },
    { key: 'drivers', header: 'Drivers', cell: (v) => v._counts?.drivers ?? '—' },
    {
      key: 'status',
      header: 'Status',
      cell: (v) => (
        <Badge variant={v.isActive !== false ? 'success' : 'destructive'}>
          {v.isActive !== false ? 'Active' : 'Suspended'}
        </Badge>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (v) => <span className="text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[170px]',
      cell: (vendor) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="icon" aria-label="Edit vendor" onClick={() => setEditTarget(vendor as unknown as Record<string, unknown>)}>
            <Pencil className="h-4 w-4" />
          </Button>
          {vendor.isActive !== false ? (
            <Button variant="ghost" size="icon" title="Suspend vendor" aria-label="Suspend vendor" disabled={isSuspending} onClick={() => setSuspendTarget({ id: vendor.id, name: vendor.name })}>
              <Pause className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" title="Reactivate vendor" aria-label="Reactivate vendor" disabled={isUnsuspending} onClick={() => unsuspendVendor(vendor.id)}>
              <Play className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title="Wipe all vendor data" aria-label="Wipe vendor data" onClick={() => setWipeTarget(vendor)}>
            <Eraser className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Delete vendor" onClick={() => setDeleteId(vendor.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={vendors}
        rowKey={(v) => v.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => {
          void refetch();
        }}
        empty={{
          title: 'No vendors yet',
          description: 'Create your first vendor to get started.',
          action: onAddVendor ? (
            <Button onClick={onAddVendor}>
              <Plus className="h-4 w-4 mr-2" />
              Add Vendor
            </Button>
          ) : undefined,
        }}
        pagination={{ page, limit, total, onPageChange: setPage, onLimitChange: setLimit }}
      />

      <VendorForm
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        vendor={editTarget}
      />

      <WipeVendorDialog vendor={wipeTarget} onOpenChange={(open) => { if (!open) setWipeTarget(null); }} />

      <ConfirmDialog
        open={!!suspendTarget}
        onOpenChange={(open) => { if (!open) setSuspendTarget(null); }}
        title="Suspend Vendor"
        description={`"${suspendTarget?.name ?? ''}" and all its users will be blocked from signing in or using the app until you reactivate it.`}
        confirmLabel="Suspend"
        onConfirm={() => { if (suspendTarget) suspendVendor(suspendTarget.id, { onSuccess: () => setSuspendTarget(null) }); }}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Vendor"
        description="This will permanently delete the vendor and all associated data. This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteVendor(deleteId, { onSuccess: () => setDeleteId(null) }); }}
      />
    </>
  );
}
