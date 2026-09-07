'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import type { SheetExpense } from '@water-supply-crm/types';
import { useVoidClosedExpense } from '../../../expenses/hooks/use-expenses';

interface VoidClosedExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  expense: SheetExpense | null;
}

export function VoidClosedExpenseDialog({ open, onClose, sheetId, expense }: VoidClosedExpenseDialogProps) {
  const { mutate: voidExpense, isPending } = useVoidClosedExpense(sheetId);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const noteValid = note.trim().length >= 3;

  const handleSubmit = () => {
    if (!expense || !noteValid) return;
    voidExpense({ id: expense.id, data: { correctionNote: note.trim() } }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete Closed-Sheet Expense
          </DialogTitle>
        </DialogHeader>

        {expense && (
          <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <p className="text-sm font-bold">
              ₨ {Number(expense.amount).toLocaleString()} · {expense.category}
            </p>
            {expense.description && (
              <p className="text-xs text-muted-foreground">{expense.description}</p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
            This sheet is closed. The expense row is <strong>permanently deleted</strong> — the only
            record kept is this reason in the audit trail. The close-time cash figure and any
            discrepancy cases stay as they were.
          </p>
        </div>

        <div className="space-y-2 py-2">
          <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
            Reason <span className="text-destructive">*</span>
          </Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this expense being removed?"
            rows={3}
            className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
          />
          {!noteValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || !noteValid}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Delete Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
