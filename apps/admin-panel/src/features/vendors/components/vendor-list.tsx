'use client';

import { useState } from 'react';
import { Button, Badge, Skeleton, DataTablePagination } from '@water-supply-crm/ui';
import { Eraser, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useVendors, useDeleteVendor, useSuspendVendor, useUnsuspendVendor } from '../hooks/use-vendors';
import { VendorForm } from './vendor-form';
import { WipeVendorDialog } from './wipe-vendor-dialog';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';

export function VendorList() {
  const { data, isLoading, page, setPage, limit, setLimit } = useVendors();
  const { mutate: deleteVendor } = useDeleteVendor();
  const { mutate: suspendVendor, isPending: isSuspending } = useSuspendVendor();
  const { mutate: unsuspendVendor, isPending: isUnsuspending } = useUnsuspendVendor();

  const [editTarget, setEditTarget] = useState<Record<string, unknown> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);
  const [wipeTarget, setWipeTarget] = useState<{ id: string; name: string; slug: string; isActive?: boolean } | null>(null);

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const vendors = (response?.data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    isActive?: boolean;
    _counts?: { customers?: number; drivers?: number }; // Note: backend uses _counts based on my update
    createdAt?: string;
  }>;
  const total = response?.meta?.total ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vendor</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customers</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Drivers</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-3 w-[170px]" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{vendor.name}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{vendor.slug}</td>
                <td className="px-4 py-3">{vendor._counts?.customers ?? '—'}</td>
                <td className="px-4 py-3">{vendor._counts?.drivers ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant={vendor.isActive !== false ? 'success' : 'destructive'}>
                    {vendor.isActive !== false ? 'Active' : 'Suspended'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {vendor.createdAt ? new Date(vendor.createdAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => setEditTarget(vendor as Record<string, unknown>)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {vendor.isActive !== false ? (
                      <Button variant="ghost" size="icon" title="Suspend vendor" disabled={isSuspending} onClick={() => setSuspendTarget({ id: vendor.id, name: vendor.name })}>
                        <Pause className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" title="Reactivate vendor" disabled={isUnsuspending} onClick={() => unsuspendVendor(vendor.id)}>
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title="Wipe all vendor data" onClick={() => setWipeTarget(vendor)}>
                      <Eraser className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(vendor.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!vendors.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No vendors found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
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
