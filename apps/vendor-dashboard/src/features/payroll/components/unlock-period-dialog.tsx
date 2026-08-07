'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { Loader2, LockOpen } from 'lucide-react';
import { useUnlockPeriod } from '../hooks/use-monthly-payroll';

interface UnlockPeriodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: string;
}

/**
 * Unlock requires a mandatory reason (§10: "only with a mandatory reason logged to
 * the audit trail") — `ConfirmDialog` has no input field, so this is a plain `Dialog`
 * with a required textarea instead of forcing a component that doesn't fit.
 */
export function UnlockPeriodDialog({ open, onOpenChange, periodId }: UnlockPeriodDialogProps) {
  const { mutate: unlock, isPending } = useUnlockPeriod();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const isValid = reason.trim().length > 0;

  const handleSubmit = () => {
    if (!isValid) return;
    unlock({ periodId, reason: reason.trim() }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2 text-destructive">
            <LockOpen className="h-5 w-5" />
            Unlock Payroll Period
          </DialogTitle>
          <DialogDescription>
            This reopens a LOCKED period back to Under Review — every entry returns to APPROVED
            and its ledger entries become claimable again. This is a rare, audited action for
            genuine mistakes only, never a routine part of the workflow. A reason is required and
            is permanently recorded on the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            placeholder="Why is this period being unlocked?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={500}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Unlock Period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
