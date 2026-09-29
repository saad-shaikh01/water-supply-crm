'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Badge, Button, Input, Label, Skeleton,
} from '@water-supply-crm/ui';
import type { FleetAlertRecipientEntry } from '@water-supply-crm/types';
import { ConfirmDialog } from '../../../../components/shared/confirm-dialog';
import {
  useAlertRecipients, useCreateAlertRecipient, useDeleteAlertRecipient, useUpdateAlertRecipient,
} from '../../hooks/use-alert-recipients';

interface AlertRecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Vendor-wide WhatsApp recipient list for the nightly Fleet sweep (document
 * expiry / maintenance due-overdue) — a second, WhatsApp channel aimed at a
 * small set of numbers (e.g. owner/manager), alongside the in-app/push alert
 * every VENDOR_ADMIN/STAFF login already gets. Not tied to an existing User —
 * the intended recipient often has no login at all.
 */
export function AlertRecipientsDialog({ open, onOpenChange }: AlertRecipientsDialogProps) {
  const { data: recipients, isLoading } = useAlertRecipients();
  const { mutate: createRecipient, isPending: isCreating } = useCreateAlertRecipient();
  const { mutate: updateRecipient } = useUpdateAlertRecipient();
  const { mutate: deleteRecipient, isPending: isDeleting } = useDeleteAlertRecipient();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pendingDelete, setPendingDelete] = useState<FleetAlertRecipientEntry | null>(null);

  const trimmedName = name.trim();
  const canAdd = trimmedName.length >= 2 && phone.trim().length >= 7;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    createRecipient(
      { name: trimmedName, phone: phone.trim() },
      {
        onSuccess: () => {
          setName('');
          setPhone('');
        },
      },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    deleteRecipient(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">WhatsApp Alert Recipients</DialogTitle>
            <DialogDescription>
              These numbers get a WhatsApp message whenever a vehicle document is expiring or maintenance is
              due/overdue — the same nightly check that already notifies every Admin/Staff login in-app.
              Switch a number off to pause its alerts without losing it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-recipient-name">Name</Label>
                <Input
                  id="new-recipient-name"
                  className="rounded-xl"
                  placeholder="e.g. Owner, Manager"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-recipient-phone">WhatsApp number</Label>
                <Input
                  id="new-recipient-phone"
                  className="rounded-xl"
                  placeholder="0300-1234567"
                  maxLength={20}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={isCreating || !canAdd} className="w-full rounded-xl font-bold gap-2">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add recipient
            </Button>
          </form>

          <div className="space-y-1.5">
            {isLoading
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-xl" />)
              : (recipients ?? []).length === 0
                ? <p className="text-sm text-muted-foreground text-center py-4">No WhatsApp alert recipients yet.</p>
                : (recipients ?? []).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground">+{r.phone}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!r.isActive && <Badge variant="outline" className="text-xs">Paused</Badge>}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg text-xs font-semibold"
                          onClick={() => updateRecipient({ id: r.id, data: { isActive: !r.isActive } })}
                        >
                          {r.isActive ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title={`Remove ${r.name}`}
                          aria-label={`Remove ${r.name}`}
                          onClick={() => setPendingDelete(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title="Remove alert recipient?"
        description={`"${pendingDelete?.name ?? ''}" will no longer receive WhatsApp alerts for document expiry or maintenance due/overdue.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </>
  );
}
