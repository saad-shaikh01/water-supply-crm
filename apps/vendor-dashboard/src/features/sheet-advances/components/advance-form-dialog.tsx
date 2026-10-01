'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, HandCoins, Info, Loader2 } from 'lucide-react';
import type { SheetAdvanceEntry } from '@water-supply-crm/types';
import { EmployeeSelect, type CrewCashEmployeeOption } from '../../crew-cash/components/employee-select';
import { useCreateSheetAdvance, useUpdateSheetAdvance } from '../hooks/use-sheet-advances';

interface AdvanceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string;
  /** This sheet's driver + crew — listed first in the employee dropdown. */
  crew: CrewCashEmployeeOption[];
  /** Present in edit mode; absent for a fresh add. */
  entry?: SheetAdvanceEntry | null;
  /** The sheet is closed — shows the notice and requires a reason (kept in the audit trail). */
  isClosed?: boolean;
}

/**
 * Add / edit a salary advance handed to an employee out of the van's cash (owner request
 * 2026-10-01). It is deducted from the day's cash hand-in the moment it is recorded — exactly
 * like an expense or crew cash — and posts to the employee's payroll ledger as an Advance, so it
 * is recovered from their salary. Works on open AND closed sheets.
 */
export function AdvanceFormDialog({ open, onOpenChange, sheetId, crew, entry, isClosed = false }: AdvanceFormDialogProps) {
  const isEdit = !!entry;
  const needsReason = isClosed;
  const { mutate: create, isPending: isCreating } = useCreateSheetAdvance(sheetId);
  const { mutate: update, isPending: isUpdating } = useUpdateSheetAdvance(sheetId);
  const isPending = isCreating || isUpdating;

  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setEmployeeId(entry?.employeeId ?? '');
    setAmount(entry?.amount);
    setNotes(entry?.notes ?? '');
    setReason('');
    // Re-sync only when the dialog opens or targets a different row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const reasonValid = !needsReason || reason.trim().length >= 3;
  const isValid = !!employeeId && !!amount && amount > 0 && reasonValid;

  const changed =
    !isEdit ||
    employeeId !== entry?.employeeId ||
    amount !== entry?.amount ||
    notes.trim() !== (entry?.notes ?? '');

  const handleSubmit = () => {
    if (!isValid || !amount) return;
    const reasonField = needsReason ? { reason: reason.trim() } : {};

    if (isEdit && entry) {
      update(
        {
          id: entry.id,
          data: {
            version: entry.version,
            ...(employeeId !== entry.employeeId && { employeeId }),
            ...(amount !== entry.amount && { amount }),
            ...(notes.trim() !== (entry.notes ?? '') && { notes: notes.trim() }),
            ...reasonField,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }

    create(
      { employeeId, amount, notes: notes.trim() || undefined, ...reasonField },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Advance' : isClosed ? 'Add Advance (Closed Sheet)' : 'Add Advance'}
          </DialogTitle>
        </DialogHeader>

        {needsReason ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
              This sheet is closed. The advance is deducted from the day&apos;s cash hand-in and posted to the
              employee&apos;s payroll ledger now; the close-time cash figure is left as it was and the change
              shows in the post-close divergence banner. A reason is required.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Paid from the van&apos;s cash — it is deducted from the day&apos;s cash hand-in and recovered from the
              employee&apos;s salary through Payroll.
            </p>
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            <EmployeeSelect value={employeeId} onChange={setEmployeeId} crew={crew} extra={entry?.employee ?? null} />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Amount (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="0"
              value={amount ?? ''}
              onChange={(e) => setAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
              className="h-12 text-xl font-black font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Notes</Label>
            <Input placeholder="Optional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {needsReason && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isEdit ? 'What was wrong?' : 'Why is this being added after the sheet closed?'}
                rows={2}
                className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
              />
              {!reasonValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
            </div>
          )}

          {isEdit && !changed && (
            <p className="text-[11px] text-muted-foreground">Change the employee, amount or notes to save.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid || !changed} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isEdit ? 'Update' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
