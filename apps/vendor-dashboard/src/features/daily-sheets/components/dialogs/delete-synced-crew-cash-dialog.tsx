'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import type { CrewCashEntry } from '@water-supply-crm/types';
import { useDeleteCrewCash } from '../../../crew-cash/hooks/use-crew-cash';
import { CREW_CASH_CATEGORY_CONFIG } from '../../../crew-cash/constants';

interface DeleteSyncedCrewCashDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  entry: CrewCashEntry | null;
  /** Resolved recipient name for the summary line. */
  employeeName: string;
}

/**
 * Delete an already-synced Crew Cash row (every row of a closed sheet that wasn't
 * waiting on approval) — the Crew Cash analogue of VoidClosedExpenseDialog. The
 * server voids (or, if payroll already used it, reverses) the linked Payroll
 * Ledger entry, removes the row and corrects the day's cash hand-in; a reason is
 * mandatory and kept in the audit trail.
 */
export function DeleteSyncedCrewCashDialog({ open, onClose, sheetId, entry, employeeName }: DeleteSyncedCrewCashDialogProps) {
  const { mutate: deleteEntry, isPending } = useDeleteCrewCash(sheetId);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const reasonValid = reason.trim().length >= 3;

  const handleSubmit = () => {
    if (!entry || !reasonValid) return;
    deleteEntry({ id: entry.id, reason: reason.trim() }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete Crew Cash Entry
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <p className="text-sm font-bold">
              ₨ {Number(entry.amount).toLocaleString()} · {(CREW_CASH_CATEGORY_CONFIG[entry.category] ?? CREW_CASH_CATEGORY_CONFIG.OTHER).label}
            </p>
            <p className="text-xs text-muted-foreground">Given to {employeeName}</p>
          </div>
        )}

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
            This entry has already been posted to the employee&apos;s payroll ledger. Deleting it
            voids that ledger entry (or reverses it if payroll already used it) and adds the amount
            back to the day&apos;s cash hand-in. The close-time cash figure stays as it was; the
            change shows in the post-close divergence banner. A reason is required.
          </p>
        </div>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </Label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this entry being removed?"
            rows={3}
            className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
          />
          {!reasonValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isPending || !reasonValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Delete Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
