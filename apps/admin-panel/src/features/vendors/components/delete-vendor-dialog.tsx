'use client';

import { useEffect } from 'react';
import { Button } from '@water-supply-crm/ui';
import { TypedConfirmDialog } from '../../../components/shared/typed-confirm-dialog';
import { apiErrorMessage, useDeleteVendor, useSuspendVendor } from '../hooks/use-vendors';
import type { DeleteBlocker } from '../types';

interface Props {
  vendor: { id: string; name: string; slug: string; isActive?: boolean } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

const blockersOf = (e: unknown): DeleteBlocker[] => {
  const b = (e as { response?: { data?: { blockers?: DeleteBlocker[] } } } | null)?.response?.data?.blockers;
  return Array.isArray(b) ? b : [];
};

/** Hard delete behind a typed-slug confirmation. A 409/400 from the API is shown with its blockers and a "suspend instead" shortcut. */
export function DeleteVendorDialog({ vendor, onOpenChange, onDeleted }: Props) {
  const del = useDeleteVendor();
  const suspend = useSuspendVendor();
  const reset = del.reset;

  useEffect(() => {
    if (!vendor) reset();
  }, [vendor, reset]);

  const blockers = blockersOf(del.error);

  return (
    <TypedConfirmDialog
      open={!!vendor}
      onOpenChange={onOpenChange}
      title="Delete vendor permanently"
      description={
        <>
          This permanently deletes <strong>{vendor?.name}</strong> and all its customers, users and catalogue. It cannot be undone. To keep the data, suspend the vendor instead.
        </>
      }
      phrase={vendor?.slug ?? ''}
      confirmLabel="Delete vendor"
      isPending={del.isPending}
      onConfirm={() => {
        if (!vendor) return;
        del.mutate(vendor.id, {
          onSuccess: () => {
            onOpenChange(false);
            onDeleted?.();
          },
        });
      }}
    >
      {del.error && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{apiErrorMessage(del.error, 'Could not delete the vendor.')}</p>
          {blockers.length > 0 && (
            <ul className="list-disc pl-5">
              {blockers.map((b) => (
                <li key={b.entity}>
                  {b.entity}
                  {b.count != null ? ` (${b.count})` : ''}
                </li>
              ))}
            </ul>
          )}
          {vendor?.isActive !== false && (
            <Button
              size="sm"
              variant="outline"
              disabled={suspend.isPending}
              onClick={() => vendor && suspend.mutate(vendor.id, { onSuccess: () => onOpenChange(false) })}
            >
              {suspend.isPending ? 'Suspending…' : 'Suspend instead'}
            </Button>
          )}
        </div>
      )}
    </TypedConfirmDialog>
  );
}
