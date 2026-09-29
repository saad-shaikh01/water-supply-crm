'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { ledgerCategoryLabel } from '../constants';
import { useVoidLedgerEntry } from '../hooks/use-ledger-entry';
import type { BreakdownLedgerEntry } from '../hooks/use-monthly-payroll';

/**
 * Void a mistakenly-entered ledger row from the payroll entry detail. Ledger rows
 * are immutable history, so "edit" = void this + Add Adjustment again with the
 * right values. Mirrors `write-off-advance-plan-dialog.tsx`'s mandatory-reason UX.
 */
interface VoidLedgerEntryDialogProps {
  entry: BreakdownLedgerEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function VoidLedgerEntryDialog({ entry, onOpenChange }: VoidLedgerEntryDialogProps) {
  const voidEntry = useVoidLedgerEntry();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (entry) setReason('');
  }, [entry]);

  if (!entry) return null;

  const linked = !!entry.causedCustomerAdjustmentId;
  const canSubmit = reason.trim().length >= 5;

  const handleVoid = () => {
    if (!canSubmit) return;
    voidEntry.mutate(
      { id: entry.id, version: entry.version, reason: reason.trim(), linked, userId: entry.userId },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !voidEntry.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Void Ledger Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <span className="font-semibold">{ledgerCategoryLabel(entry.category)}</span>
            <span className="font-mono font-bold ml-2">
              {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}
            </span>
            {entry.description && <p className="text-xs text-muted-foreground">{entry.description}</p>}
          </div>
          <p className="text-sm text-muted-foreground">
            The entry stays in the audit history but stops counting toward payroll. To correct an amount, void
            it and add a new adjustment with the right value.
            {linked && ' This penalty is linked to a customer credit — that credit is reversed together with it.'}
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this entry being voided?"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={voidEntry.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit || voidEntry.isPending}
            className="rounded-xl font-bold"
          >
            {voidEntry.isPending ? 'Voiding…' : 'Void Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
