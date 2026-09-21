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
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { apiErrorMessage } from '../api/customer-adjustments.api';
import { useVoidBalanceTransfer } from '../hooks/use-customer-adjustments';
import { fmtAdjustmentAmount } from '../format';

/** Mirrors the backend VoidCustomerFinancialAdjustmentDto constraints. */
const VOID_REASON_MIN = 5;
const VOID_REASON_MAX = 500;

interface VoidTransferDialogProps {
  /** The adjustment row that was clicked — used to show context. */
  adjustment: {
    groupId: string;
    amount: number;
    counterpartyCustomerId: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once both legs have been voided (caller can close the detail dialog). */
  onVoided: () => void;
}

/**
 * Voids BOTH legs of a balance transfer as a group.
 *
 * A transfer void is different from a single-adjustment void:
 *  - Both the TRANSFER_OUT and TRANSFER_IN are reversed simultaneously.
 *  - The endpoint is `POST /customer-financial-adjustments/transfers/:groupId/void`.
 *  - A reason is mandatory (≥ 5 chars), just like a single-adjustment void.
 *
 * The backend has no balance floor — if the target has paid down what was transferred,
 * voiding leaves it with a credit (that is the correct accounting outcome).
 */
export function VoidTransferDialog({ adjustment, open, onOpenChange, onVoided }: VoidTransferDialogProps) {
  const voidTransfer = useVoidBalanceTransfer();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setAttempted(false);
      voidTransfer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < VOID_REASON_MIN;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (voidTransfer.isPending) return;
    setAttempted(true);
    if (tooShort) return;
    voidTransfer.mutate(
      { groupId: adjustment.groupId, reason: trimmed },
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
            <Ban className="h-5 w-5 text-destructive" /> Void balance transfer
          </DialogTitle>
          <DialogDescription>
            {fmtAdjustmentAmount(adjustment.amount)} — both legs will be reversed simultaneously.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            This reverses{' '}
            <span className="font-bold text-foreground dark:text-white">
              {fmtAdjustmentAmount(adjustment.amount)}
            </span>{' '}
            on <em>both</em> accounts by posting a reversal on each. Neither entry is deleted — all four rows
            (the two original legs and the two reversals) remain on the ledger and both customers' statements.
            This cannot be undone.
          </p>

          {adjustment.counterpartyCustomerId && (
            <Link
              href={`/dashboard/customers/${adjustment.counterpartyCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary font-bold hover:underline"
            >
              View other account <ExternalLink className="h-3 w-3" />
            </Link>
          )}

          <div className="space-y-2">
            <Label htmlFor="void-transfer-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="void-transfer-reason"
              value={reason}
              maxLength={VOID_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`At least ${VOID_REASON_MIN} characters — why is this transfer being voided?`}
              className="rounded-xl min-h-20"
              autoFocus
            />
            {attempted && tooShort ? (
              <p className="text-xs text-destructive">
                A reason of at least {VOID_REASON_MIN} characters is required.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Staff-only — recorded permanently, never shown to the customer.
              </p>
            )}
          </div>

          {voidTransfer.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(voidTransfer.error, 'Failed to void the transfer. Nothing was changed.')}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={voidTransfer.isPending} className="rounded-xl font-bold">
              {voidTransfer.isPending ? 'Voiding…' : 'Void transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
