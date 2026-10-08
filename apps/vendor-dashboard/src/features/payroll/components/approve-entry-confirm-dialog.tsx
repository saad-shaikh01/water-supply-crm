'use client';

import { AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button,
} from '@water-supply-crm/ui';

interface ApproveEntryConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  /** Absent / half-day days with no paid/unpaid decision (MONTHLY employees). */
  pendingAbsenceDays: number;
  finalPayable: number;
  /** Deduction held back by the max-deduction limit, if any. */
  deferredOut?: number;
  isLoading?: boolean;
  onConfirm: () => void;
}

/**
 * Soft gate before approving an entry that has something an admin should knowingly accept: absent days nobody
 * decided on (approving pays them in full) or a negative payable. Never blocks - "Approve anyway" always works.
 */
export function ApproveEntryConfirmDialog({
  open, onOpenChange, employeeName, pendingAbsenceDays, finalPayable, deferredOut = 0, isLoading, onConfirm,
}: ApproveEntryConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !isLoading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[460px] rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Approve {employeeName}?
          </DialogTitle>
          <DialogDescription>Please check the following before approving.</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-sm">
          {pendingAbsenceDays > 0 && (
            <li className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <strong>
                {pendingAbsenceDays} absent / half-day day{pendingAbsenceDays === 1 ? '' : 's'}
              </strong>{' '}
              {pendingAbsenceDays === 1 ? 'has' : 'have'} no paid / unpaid decision. If you approve now,{' '}
              {pendingAbsenceDays === 1 ? 'it is' : 'they are'} <strong>paid in full</strong> (no deduction). Open the
              Attendance tab to mark them Unpaid or Paid first.
            </li>
          )}
          {finalPayable < 0 && (
            <li className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              Deductions are <strong>₨ {Math.abs(finalPayable).toLocaleString()} more than the salary</strong>. The
              employee ends up owing this amount, and it carries forward to the next period.
            </li>
          )}
          {deferredOut > 0 && (
            <li className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5">
              ₨ {deferredOut.toLocaleString()} of deductions is held back by the maximum-deduction limit and will be
              charged in the next period.
            </li>
          )}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Review first
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Approving…' : 'Approve anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
