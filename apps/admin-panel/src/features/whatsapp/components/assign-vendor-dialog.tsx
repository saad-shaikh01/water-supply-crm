'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { NativeSelect } from '../../observability/components/native-select';
import { useAssignableVendors, useAssignVendor } from '../hooks/use-whatsapp-accounts';
import type { WhatsAppAccountRow } from '../api/whatsapp.api';

interface Props {
  account: WhatsAppAccountRow | null;
  onClose: () => void;
}

export function AssignVendorDialog({ account, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [replaceFor, setReplaceFor] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!account) {
      setSearch('');
      setQ('');
      setVendorId('');
      setReplaceFor(null);
    }
  }, [account]);

  const vendors = useAssignableVendors(q, !!account);
  const assign = useAssignVendor((c) => setReplaceFor(c.vendorId));

  const submit = (replace?: boolean) => {
    if (!account || !vendorId) return;
    assign.mutate({ id: account.id, vendorId, replace }, { onSuccess: onClose, onSettled: () => replace && setReplaceFor(null) });
  };

  return (
    <>
      <Dialog open={!!account && !replaceFor} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign vendor</DialogTitle>
            <DialogDescription>Choose a vendor to send WhatsApp messages through {account?.label}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="wa-vendor-search">Search vendors</Label>
              <Input id="wa-vendor-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wa-vendor-select">Vendor</Label>
              <NativeSelect id="wa-vendor-select" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{vendors.isLoading ? 'Loading...' : 'Select a vendor'}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </NativeSelect>
              {vendors.data && vendors.data.length === 0 && <p className="text-xs text-muted-foreground">No vendors without a WhatsApp account.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => submit()} disabled={!vendorId || assign.isPending}>
              {assign.isPending ? 'Assigning...' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!replaceFor}
        onOpenChange={(o) => !o && setReplaceFor(null)}
        title="Replace existing account?"
        description="This vendor already has a different WhatsApp account. Replacing it switches the vendor to this account; the previous account is not deleted."
        confirmLabel="Replace"
        isPending={assign.isPending}
        onConfirm={() => submit(true)}
      />
    </>
  );
}
