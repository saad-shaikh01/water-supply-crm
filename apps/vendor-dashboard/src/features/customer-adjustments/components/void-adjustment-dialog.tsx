'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Ban } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { apiErrorMessage, type CustomerAdjustment } from '../api/customer-adjustments.api';
import { useVoidCustomerAdjustment } from '../hooks/use-customer-adjustments';
import { adjustmentKindLabel, directionSign, fmtAdjustmentAmount } from '../format';

/** Same bounds as the backend's void DTO (a reason is mandatory and permanent). */
export const VOID_REASON_MIN_LENGTH = 5;
export const VOID_REASON_MAX_LENGTH = 500;

interface VoidAdjustmentDialogProps {
  adjustment: CustomerAdjustment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the void has been posted (the caller closes whatever is showing the adjustment). */
  onVoided: () => void;
}

/**
 * Voids a POSTED adjustment. Nothing is edited or deleted: the backend posts a REVERSAL that
 * cancels it and restores the balance, and records this reason permanently (staff-only — never
 * shown to the customer). The dialog states exactly that, since it is not undoable.
 */
export function VoidAdjustmentDialog({ adjustment, open, onOpenChange, onVoided }: VoidAdjustmentDialogProps) {
  const voidAdjustment = useVoidCustomerAdjustment();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setAttempted(false);
      voidAdjustment.reset();
    }
    // Only when the dialog opens: `voidAdjustment` changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = reason.trim();
  const reasonTooShort = trimmed.length < VOID_REASON_MIN_LENGTH;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (voidAdjustment.isPending) return; // Enter in the field can submit while the button is disabled
    setAttempted(true);
    if (reasonTooShort) return;
    voidAdjustment.mutate(
      { id: adjustment.id, reason: trimmed },
      {
        onSuccess: () => {
          onOpenChange(false);
          onVoided();
        },
      },
    );
  };

  const isCharge = adjustment.direction === 'CHARGE';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" /> Void adjustment
          </DialogTitle>
          <DialogDescription>
            {adjustmentKindLabel(adjustment.kind)} · {adjustment.title}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            This cancels{' '}
            <span className="font-bold text-foreground dark:text-white">
              {directionSign(adjustment.direction)} {fmtAdjustmentAmount(adjustment.amount)}
            </span>{' '}
            by posting a reversal, which {isCharge ? 'lowers' : 'raises'} {adjustment.customer.name}’s balance by the same
            amount. Nothing is deleted — both entries stay on the ledger and the customer’s statement, and the void cannot be
            undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="void-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="void-reason"
              value={reason}
              maxLength={VOID_REASON_MAX_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`At least ${VOID_REASON_MIN_LENGTH} characters — why is this being voided?`}
              className="rounded-xl min-h-20"
              autoFocus
            />
            {attempted && reasonTooShort ? (
              <p className="text-xs text-destructive">A reason of at least {VOID_REASON_MIN_LENGTH} characters is required.</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Staff-only — recorded permanently, never shown to the customer.</p>
            )}
          </div>

          {voidAdjustment.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(voidAdjustment.error, 'Failed to void the adjustment. Nothing was changed.')}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={voidAdjustment.isPending} className="rounded-xl font-bold">
              {voidAdjustment.isPending ? 'Voiding…' : 'Void adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
