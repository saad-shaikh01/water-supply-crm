'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import { TypedConfirmDialog } from '../../../components/shared/typed-confirm-dialog';
import { apiErrorMessage, useBulkVendorAction } from '../hooks/use-vendors';
import type { BulkResult } from '../types';

export type BulkAction = 'suspend' | 'unsuspend';

interface Props {
  open: boolean;
  action: BulkAction;
  vendors: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
}

const MAX_LISTED = 10;

/** The phrase the operator must type, e.g. `SUSPEND 3` / `REACTIVATE 3`. */
export const bulkPhrase = (action: BulkAction, count: number) => `${action === 'suspend' ? 'SUSPEND' : 'REACTIVATE'} ${count}`;

export function BulkConfirmDialog({ open, action, vendors, onOpenChange }: Props) {
  const mutation = useBulkVendorAction(action);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (!open) {
      setReason('');
      setResult(null);
      resetMutation();
    }
  }, [open, resetMutation]);

  const verb = action === 'suspend' ? 'Suspend' : 'Reactivate';
  const nameOf = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;

  if (result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {verb} results: {result.succeeded} succeeded, {result.failed} failed
            </DialogTitle>
          </DialogHeader>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border text-sm" aria-label="Bulk results">
            {result.results.map((r) => (
              <li key={r.id} className="flex items-start gap-2 px-3 py-2" data-result={r.ok ? 'ok' : 'failed'}>
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden="true" />}
                <span className="font-medium">{nameOf(r.id)}</span>
                <span className="ml-auto text-right text-muted-foreground">{r.ok ? 'Done' : r.error}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <TypedConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${verb} ${vendors.length} vendor${vendors.length === 1 ? '' : 's'}`}
      description={
        action === 'suspend'
          ? 'Every user of these vendors is blocked from signing in until they are reactivated.'
          : 'These vendors and all their users regain access immediately.'
      }
      phrase={bulkPhrase(action, vendors.length)}
      confirmLabel={verb}
      destructive={action === 'suspend'}
      isPending={mutation.isPending}
      onConfirm={() => mutation.mutate({ ids: vendors.map((v) => v.id), reason: reason.trim() || undefined }, { onSuccess: setResult })}
    >
      <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm" aria-label="Selected vendors">
        {vendors.slice(0, MAX_LISTED).map((v) => (
          <li key={v.id}>{v.name}</li>
        ))}
        {vendors.length > MAX_LISTED && <li className="list-none text-muted-foreground">and {vendors.length - MAX_LISTED} more</li>}
      </ul>
      <div className="space-y-1.5">
        <Label htmlFor="bulk-reason">Reason (optional)</Label>
        <Input id="bulk-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(mutation.error, 'The bulk action failed.')}
        </p>
      )}
    </TypedConfirmDialog>
  );
}
