'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import type { SheetAdvanceEntry } from '@water-supply-crm/types';
import { useDeleteSheetAdvance } from '../hooks/use-sheet-advances';

interface DeleteAdvanceDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  entry: SheetAdvanceEntry | null;
  /** Closed sheet → a reason is mandatory (kept in the audit trail). On an open sheet it is optional. */
  isClosed: boolean;
}

/**
 * Delete (void) a Daily Sheet advance. The server voids the employee's payroll ledger entry — or
 * reverses it in the current payroll period if payroll already used it — and the amount goes back
 * into the day's cash hand-in. The row itself is kept (soft delete) for the audit trail.
 */
export function DeleteAdvanceDialog({ open, onClose, sheetId, entry, isClosed }: DeleteAdvanceDialogProps) {
  const { mutate: deleteAdvance, isPending } = useDeleteSheetAdvance(sheetId);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const reasonValid = !isClosed || reason.trim().length >= 3;
  const lockedInPayroll = !!entry?.staffLedgerEntry?.payrollEntryId;

  const handleSubmit = () => {
    if (!entry || !reasonValid) return;
    deleteAdvance({ id: entry.id, reason: reason.trim() || undefined }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete Advance
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <p className="text-sm font-bold">₨ {Number(entry.amount).toLocaleString()} · {entry.employee.name}</p>
            {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
          </div>
        )}

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
            {lockedInPayroll
              ? 'This advance was already used in a locked payroll period, so it is reversed in the current payroll period instead of being erased. '
              : 'The advance is voided on the employee’s payroll ledger. '}
            The amount goes back into the day&apos;s cash hand-in.
            {isClosed && ' This sheet is closed, so the close-time cash figure stays as it was and the change shows in the post-close divergence banner.'}
          </p>
        </div>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Reason {isClosed && <span className="text-destructive">*</span>}
          </Label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isClosed ? 'Why is this advance being removed?' : 'Optional'}
            rows={2}
            className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
          />
          {isClosed && !reasonValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isPending || !reasonValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Delete Advance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
