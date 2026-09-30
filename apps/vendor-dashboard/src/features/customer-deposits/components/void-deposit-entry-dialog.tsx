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
import { apiErrorMessage, type CustomerDeposit, type CustomerDepositEntry } from '../api/customer-deposits.api';
import { useVoidDepositEntry } from '../hooks/use-customer-deposits';
import { DEPOSIT_DIRECTION_LABELS, depositDirectionSign, depositTitle, fmtDepositAmount } from '../format';

export const VOID_REASON_MIN_LENGTH = 5;
export const VOID_REASON_MAX_LENGTH = 500;

interface VoidDepositEntryDialogProps {
  deposit: CustomerDeposit;
  entry: CustomerDepositEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoided: () => void;
}

/**
 * Voids a POSTED deposit entry. Nothing is edited or deleted: the backend
 * posts a REVERSAL entry that cancels it and restores the balance, and
 * records this reason permanently. Not undoable.
 */
export function VoidDepositEntryDialog({ deposit, entry, open, onOpenChange, onVoided }: VoidDepositEntryDialogProps) {
  const voidEntry = useVoidDepositEntry();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setAttempted(false);
      voidEntry.reset();
    }
    // Only when the dialog opens: `voidEntry` changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = reason.trim();
  const reasonTooShort = trimmed.length < VOID_REASON_MIN_LENGTH;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (voidEntry.isPending) return;
    setAttempted(true);
    if (reasonTooShort) return;
    voidEntry.mutate(
      { entryId: entry.id, reason: trimmed },
      {
        onSuccess: () => {
          onOpenChange(false);
          onVoided();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" /> Void entry
          </DialogTitle>
          <DialogDescription>
            {depositTitle(deposit)} · {DEPOSIT_DIRECTION_LABELS[entry.direction]}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            This cancels{' '}
            <span className="font-bold text-foreground dark:text-white">
              {depositDirectionSign(entry.direction)} {fmtDepositAmount(deposit.type, entry.amount)}
            </span>{' '}
            by posting a reversal. Nothing is deleted — both entries stay on the history, and the void cannot be
            undone.
          </p>

          <div className="space-y-2">
            <Label htmlFor="void-deposit-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="void-deposit-reason"
              value={reason}
              maxLength={VOID_REASON_MAX_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`At least ${VOID_REASON_MIN_LENGTH} characters — why is this being voided?`}
              className="rounded-xl min-h-20"
              autoFocus
            />
            {attempted && reasonTooShort && (
              <p className="text-xs text-destructive">A reason of at least {VOID_REASON_MIN_LENGTH} characters is required.</p>
            )}
          </div>

          {voidEntry.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(voidEntry.error, 'Failed to void the entry')}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={voidEntry.isPending} className="rounded-xl font-bold">
              {voidEntry.isPending ? 'Voiding…' : 'Void entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
