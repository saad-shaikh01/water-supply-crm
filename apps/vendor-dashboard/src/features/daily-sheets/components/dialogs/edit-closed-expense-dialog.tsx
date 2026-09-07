'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { AlertTriangle, Pencil, Plus, Loader2 } from 'lucide-react';
import type { SheetExpense } from '@water-supply-crm/types';
import { useAllVans } from '../../../vans/hooks/use-vans';
import {
  useCorrectClosedExpense,
  useAddClosedSheetExpense,
} from '../../../expenses/hooks/use-expenses';

// Same selectable list ExpenseForm offers (retired categories are not pickable —
// but an existing row still tagged with one is shown disabled so the field
// isn't blank on edit).
const CATEGORIES = [
  { value: 'VEHICLE_MAINTENANCE', label: 'Vehicle Maintenance' },
  { value: 'ICE_PURCHASED', label: 'Ice Purchased' },
  { value: 'EXTRA_LOADER', label: 'Extra Loader' },
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'STATIONARY', label: 'Stationary' },
  { value: 'BOTTLE_PURCHASED', label: 'Bottle Purchase' },
  { value: 'CAPS_PURCHASED', label: 'Caps Purchase' },
  { value: 'CHEMICALS_PURCHASED', label: 'Chemicals Purchase' },
  { value: 'OTHER', label: 'Others' },
] as const;

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  LUNCH_EXPENSE_EMPLOYEE: 'Lunch Exp Employee (retired)',
  ADVANCE_SALARY_EMPLOYEE: 'Adv Salary Employee (retired)',
  FUEL_EXPENSE: 'Fuel Exp (retired)',
};

interface EditClosedExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  sheetDate?: string;
  /** null → add-a-missed-expense flow; a row → correct that row. */
  expense: SheetExpense | null;
}

export function EditClosedExpenseDialog({
  open,
  onClose,
  sheetId,
  sheetDate,
  expense,
}: EditClosedExpenseDialogProps) {
  const isAdd = !expense;
  const { mutate: correct, isPending: isCorrecting } = useCorrectClosedExpense(sheetId);
  const { mutate: add, isPending: isAdding } = useAddClosedSheetExpense(sheetId);
  const isPending = isCorrecting || isAdding;

  const { data: vansData } = useAllVans();
  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string; isActive?: boolean }>;
  const activeVans = vans.filter((v) => v.isActive !== false);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('OTHER');
  const [date, setDate] = useState('');
  const [vanId, setVanId] = useState<string>('none');
  const [description, setDescription] = useState('');
  const [paidFromCash, setPaidFromCash] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setAmount(String(expense.amount ?? ''));
      setCategory(expense.category ?? 'OTHER');
      setDate((expense.date ?? '').slice(0, 10));
      setVanId(expense.vanId ?? 'none');
      setDescription(expense.description ?? '');
      setPaidFromCash(expense.paidFromCash !== false);
    } else {
      setAmount('');
      setCategory('OTHER');
      setDate((sheetDate ?? new Date().toISOString()).slice(0, 10));
      setVanId('none');
      setDescription('');
      setPaidFromCash(true);
    }
    setNote('');
  }, [open, expense, sheetDate]);

  const noteValid = note.trim().length >= 3;
  const amountValid = amount !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0.01;
  const descriptionValid = description.trim().length > 0;
  const isValid = noteValid && amountValid && descriptionValid && !!date;

  const handleSubmit = () => {
    if (!isValid) return;
    const body: Record<string, unknown> = {
      amount: Number(amount),
      category,
      description: description.trim(),
      date,
      paidFromCash,
      vanId: vanId === 'none' ? undefined : vanId,
      correctionNote: note.trim(),
    };
    if (isAdd) {
      add(body, { onSuccess: onClose });
    } else {
      correct({ id: expense!.id, data: body }, { onSuccess: onClose });
    }
  };

  const Icon = isAdd ? Plus : Pencil;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {isAdd ? 'Add Expense to Closed Sheet' : 'Correct Closed-Sheet Expense'}
          </DialogTitle>
        </DialogHeader>

        {/* Warning banner */}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
            This sheet is closed. The close-time cash figure and any discrepancy cases stay as they
            were — this change is surfaced by the post-close divergence banner and the analytics
            rollups. A reason is required and is kept in the audit trail.
          </p>
        </div>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Amount (₨)</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Date</Label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEGACY_CATEGORY_LABELS[category] && (
                  <SelectItem value={category} disabled>{LEGACY_CATEGORY_LABELS[category]}</SelectItem>
                )}
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Van (optional)</Label>
            <Select value={vanId} onValueChange={setVanId}>
              <SelectTrigger><SelectValue placeholder="No van" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No van</SelectItem>
                {activeVans.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">Description <span className="text-destructive">*</span></Label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this expense for?"
              className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
            />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-border/50 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={paidFromCash}
              onChange={(e) => setPaidFromCash(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-xs text-muted-foreground font-medium">
              Paid from van cash (deducted from the driver&apos;s hand-in). Uncheck if paid by card / bank / company account.
            </span>
          </label>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain what was wrong / why this is being added…"
              rows={3}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
            />
            {!noteValid && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
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
            {isAdd ? 'Add Expense' : 'Save Correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
