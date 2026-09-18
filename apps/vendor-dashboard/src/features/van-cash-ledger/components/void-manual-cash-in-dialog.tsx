'use client';

import { useEffect, useId, useState } from 'react';
import { Ban, Info } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { useVoidManualCashIn } from '../hooks/use-van-cash-ledger';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';
import { fmtDate, money } from '../format';

interface VoidManualCashInDialogProps {
  row: CashLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_REASON = 5;

/** Deletes (voids) a manual cash-in: it stops counting toward the balance but stays visible as voided. */
export function VoidManualCashInDialog({ row, open, onOpenChange }: VoidManualCashInDialogProps) {
  const voidCashIn = useVoidManualCashIn();
  const reasonHelpId = useId();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open, row]);

  if (!row) return null;

  const canSubmit = reason.trim().length >= MIN_REASON && !voidCashIn.isPending && !!row.sourceRecordId;

  const handleVoid = () => {
    if (!canSubmit || !row.sourceRecordId) return;
    voidCashIn.mutate(
      { id: row.sourceRecordId, data: { version: row.version ?? 1, reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Delete Cash In Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <dl className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-bold font-mono">{money(row.displayAmount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-bold">{fmtDate(row.date)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Note</dt>
              <dd className="font-medium text-right break-words min-w-0">{row.notes?.trim() || '—'}</dd>
            </div>
          </dl>

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-500 px-3 py-3 text-xs">
            <Info className="h-4 w-4 mt-px shrink-0" aria-hidden />
            <p>
              To fix a mistake, use Edit — delete an entry only if it should never have existed. It stops
              counting toward the balance and stays visible as voided.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-cash-in-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="void-cash-in-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={reasonHelpId}
              aria-required
              maxLength={500}
              placeholder="e.g. Entered twice by mistake"
              className="rounded-xl min-h-20"
            />
            <p id={reasonHelpId} className="text-xs text-muted-foreground">
              Kept in the audit trail (at least {MIN_REASON} characters).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit}
            className="rounded-xl font-bold min-h-11"
          >
            {voidCashIn.isPending ? 'Deleting…' : 'Delete entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
