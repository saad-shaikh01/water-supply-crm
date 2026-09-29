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
  Input,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import type { CustomerDeposit } from '../api/customer-deposits.api';
import { apiErrorMessage } from '../api/customer-deposits.api';
import { useWriteOffDeposit } from '../hooks/use-customer-deposits';
import { depositTitle, fmtDepositAmount } from '../format';

const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';
export const WRITE_OFF_NOTE_MIN_LENGTH = 5;

interface WriteOffDepositDialogProps {
  deposit: CustomerDeposit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Closes out part or all of a deposit WITHOUT a matching cash/bottle
 * movement — a company loss (e.g. the customer left without returning
 * deposit bottles, or the vendor is forgoing a refund). A note is mandatory
 * and permanent, since nothing else records why.
 */
export function WriteOffDepositDialog({ deposit, open, onOpenChange }: WriteOffDepositDialogProps) {
  const writeOff = useWriteOffDeposit(deposit.id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(String(deposit.balance));
      setNote('');
      setAttempted(false);
      writeOff.reset();
    }
    // Only when the dialog opens: `writeOff`/`deposit` change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const amountInvalid =
    parsedAmount === null ||
    !Number.isFinite(parsedAmount) ||
    parsedAmount <= 0 ||
    parsedAmount - deposit.balance > 1e-6 ||
    (deposit.type === 'BOTTLE' && !Number.isInteger(parsedAmount));
  const trimmedNote = note.trim();
  const noteTooShort = trimmedNote.length < WRITE_OFF_NOTE_MIN_LENGTH;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (writeOff.isPending) return;
    setAttempted(true);
    if (amountInvalid || noteTooShort) return;
    writeOff.mutate(
      { amount: parsedAmount as number, note: trimmedNote },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" /> Write off {depositTitle(deposit)}
          </DialogTitle>
          <DialogDescription>
            Held: {fmtDepositAmount(deposit.type, deposit.balance)} — closed out as a company loss, no cash or
            bottles move.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className={FIELD_LABEL}>{deposit.type === 'CASH' ? 'Amount (₨)' : 'Bottles'}</Label>
            <Input
              type="number"
              min={0}
              max={deposit.balance}
              step={deposit.type === 'CASH' ? '0.01' : '1'}
              inputMode={deposit.type === 'CASH' ? 'decimal' : 'numeric'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 rounded-xl"
            />
            {attempted && amountInvalid && (
              <p className="text-xs text-destructive">
                Cannot exceed the held deposit ({fmtDepositAmount(deposit.type, deposit.balance)}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className={FIELD_LABEL}>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`At least ${WRITE_OFF_NOTE_MIN_LENGTH} characters`}
              className="rounded-xl min-h-20"
              autoFocus
            />
            {attempted && noteTooShort && (
              <p className="text-xs text-destructive">A reason of at least {WRITE_OFF_NOTE_MIN_LENGTH} characters is required.</p>
            )}
          </div>

          {writeOff.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(writeOff.error, 'Failed to write off the deposit')}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={writeOff.isPending} className="rounded-xl font-bold">
              {writeOff.isPending ? 'Writing off…' : 'Write off'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
