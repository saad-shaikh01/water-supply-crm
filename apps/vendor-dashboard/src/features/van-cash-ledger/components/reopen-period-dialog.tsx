'use client';

import { useEffect, useId, useState } from 'react';
import { Info, Unlock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { useCashLedgerPeriods, useReopenPeriod } from '../hooks/use-cash-ledger-periods';
import { periodLabelToDisplay } from './period-drift-chip';

interface ReopenPeriodDialogProps {
  /** "YYYY-MM" of the closed period to reopen. */
  label: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_REASON = 10;
const MAX_REASON = 500;

/** Reopens the most recent closed period (mandatory reason, kept in the audit trail). */
export function ReopenPeriodDialog({ label, open, onOpenChange }: ReopenPeriodDialogProps) {
  const reopen = useReopenPeriod();
  const periods = useCashLedgerPeriods();
  const reasonHelpId = useId();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open, label]);

  const displayLabel =
    periods.data?.periods.find((p) => p.label === label)?.displayLabel ?? periodLabelToDisplay(label);
  const trimmedLength = reason.trim().length;
  const canSubmit = !!label && trimmedLength >= MIN_REASON && !reopen.isPending;

  const handleReopen = () => {
    if (!canSubmit || !label) return;
    reopen.mutate(
      { label, data: { reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (reopen.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Unlock className="h-5 w-5 text-amber-500" aria-hidden />
            Reopen {displayLabel || 'period'}
          </DialogTitle>
          <DialogDescription>
            Make this closed accounting period editable again. The reason is kept in the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 px-3 py-3 text-xs">
            <Info className="h-4 w-4 mt-px shrink-0" aria-hidden />
            <p>
              Only the most recent closed period can be reopened. Entries in it become editable again until you
              close it, and the closing snapshot will be retaken.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reopen-period-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reopen-period-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={reasonHelpId}
              aria-required
              maxLength={MAX_REASON}
              placeholder="e.g. Missed owner transfer for 28 Aug needs recording"
              className="rounded-xl min-h-24"
            />
            <p id={reasonHelpId} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>At least {MIN_REASON} characters.</span>
              <span
                aria-live="polite"
                className={trimmedLength >= MIN_REASON ? 'font-mono tabular-nums' : 'font-mono tabular-nums text-amber-600 dark:text-amber-400'}
              >
                {trimmedLength}/{MIN_REASON}
                <span className="sr-only">{trimmedLength >= MIN_REASON ? ' — long enough' : ' — too short'}</span>
              </span>
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={reopen.isPending} className="min-h-11">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReopen}
            disabled={!canSubmit}
            className="rounded-xl font-bold min-h-11"
          >
            {reopen.isPending ? 'Reopening…' : 'Reopen period'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
