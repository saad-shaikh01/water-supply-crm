'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea } from '@water-supply-crm/ui';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  isPending?: boolean;
  onConfirm: (reason: string) => void;
}

/** Confirmation that requires a written reason (3-500 chars, matching the API). Cleared on close. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive = true, isPending, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!open) setReason('');
  }, [open]);
  const valid = reason.trim().length >= 3 && reason.trim().length <= 500;

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="admin-reason">Reason</Label>
          <Textarea id="admin-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this needed? (recorded in the audit log)" />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={!valid || isPending} onClick={() => onConfirm(reason.trim())}>
            {isPending ? 'Please wait...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
