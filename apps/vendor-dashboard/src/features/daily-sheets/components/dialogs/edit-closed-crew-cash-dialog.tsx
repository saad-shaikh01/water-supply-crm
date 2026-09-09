'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { AlertTriangle, Pencil, Loader2 } from 'lucide-react';
import type { CrewCashCategory, CrewCashEntry } from '@water-supply-crm/types';
import { useCorrectCrewCash } from '../../../crew-cash/hooks/use-crew-cash';
import { CREW_CASH_CATEGORY_CONFIG, CREW_CASH_CATEGORIES } from '../../../crew-cash/constants';
import type { CrewCashEmployeeOption } from '../../../crew-cash/components/crew-cash-form';

interface EditClosedCrewCashDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  /** Confirmed crew for this sheet — the reassignment target picker. */
  crewMembers: CrewCashEmployeeOption[];
  /** The synced row being corrected. */
  entry: CrewCashEntry | null;
}

/**
 * Post-close correction of a synced Crew Cash row — the Crew Cash analogue of
 * EditClosedExpenseDialog. Only the fields the user actually changed are sent
 * (`newEmployeeId` / `newCategory` / `newAmount`); the backend reverses the
 * linked Staff Ledger entry, posts a fresh one and rewrites the row. A reason
 * is mandatory and kept in the audit trail.
 */
export function EditClosedCrewCashDialog({
  open,
  onClose,
  sheetId,
  crewMembers,
  entry,
}: EditClosedCrewCashDialogProps) {
  const { mutate: correct, isPending } = useCorrectCrewCash(sheetId);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CrewCashCategory>('OTHER');
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open || !entry) return;
    setAmount(String(entry.amount ?? ''));
    setCategory(entry.category);
    setEmployeeId(entry.employeeId);
    setReason('');
  }, [open, entry]);

  const reasonValid = reason.trim().length >= 3;
  const amountNum = Number(amount);
  const amountValid = amount !== '' && Number.isInteger(amountNum) && amountNum >= 1;

  const amountChanged = !!entry && amountValid && amountNum !== entry.amount;
  const categoryChanged = !!entry && category !== entry.category;
  const employeeChanged = !!entry && !!employeeId && employeeId !== entry.employeeId;
  const somethingChanged = amountChanged || categoryChanged || employeeChanged;

  const isValid = !!entry && reasonValid && amountValid && somethingChanged;

  const handleSubmit = () => {
    if (!isValid || !entry) return;
    correct(
      {
        id: entry.id,
        data: {
          reason: reason.trim(),
          ...(amountChanged && { newAmount: amountNum }),
          ...(categoryChanged && { newCategory: category }),
          ...(employeeChanged && { newEmployeeId: employeeId }),
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Correct Closed-Sheet Crew Cash
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
            This sheet is closed. The Staff Ledger entry is reversed and re-posted with the
            corrected values, and the close-time cash figure is left as it was — the change is
            surfaced by the post-close divergence banner and the analytics rollups. A reason is
            required and is kept in the audit trail.
          </p>
        </div>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Amount (₨)</Label>
              <input
                type="number"
                min={1}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as CrewCashCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREW_CASH_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CREW_CASH_CATEGORY_CONFIG[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select crew member" /></SelectTrigger>
              <SelectContent>
                {crewMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
                {entry && !crewMembers.some((m) => m.id === entry.employeeId) && (
                  <SelectItem value={entry.employeeId}>Current employee</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what was wrong…"
              rows={3}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
            />
            {!reasonValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
            {reasonValid && !somethingChanged && (
              <p className="text-[11px] text-muted-foreground">Change the amount, category or employee to correct.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !isValid}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
