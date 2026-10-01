'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { AlertTriangle, Loader2, Wallet } from 'lucide-react';
import type { CrewCashEntry } from '@water-supply-crm/types';
import { CREW_CASH_CATEGORY_CONFIG, selectableCrewCashCategories } from '../constants';
import { useCreateCrewCash, useUpdateCrewCash } from '../hooks/use-crew-cash';
import { EmployeeSelect, type CrewCashEmployeeOption } from './employee-select';

export type { CrewCashEmployeeOption };

interface CrewCashFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string;
  /**
   * This sheet's driver + confirmed crew — listed FIRST in the employee dropdown.
   * Any other active employee is selectable too (owner request 2026-10-01).
   */
  employees: CrewCashEmployeeOption[];
  /** Present in edit mode; absent for a fresh add. */
  entry?: CrewCashEntry | null;
  /**
   * The sheet is closed — this is a post-close add. Shows the closed-sheet notice and
   * requires a reason (kept in the audit trail), like adding an expense to a closed sheet.
   */
  isClosed?: boolean;
}

interface FormState {
  employeeId: string;
  category: CrewCashEntry['category'] | undefined;
  amount: number | undefined;
  notes: string;
}

const emptyForm: FormState = { employeeId: '', category: undefined, amount: undefined, notes: '' };

/**
 * Add/edit dialog for a Crew Cash Distribution entry — sibling of `ExpenseForm`
 * but tuned for the moving-Salesman workflow (doc §4/§13): tappable employee +
 * category chips instead of dropdowns, amount defaults empty, notes optional.
 *
 * Quick-repeat (§4): on a successful ADD, the dialog stays open and resets only
 * employee/amount/notes — the category chip stays selected, so recording tea for
 * three crew members is three fast taps, not three full dialog round-trips.
 */
export function CrewCashForm({ open, onOpenChange, sheetId, employees, entry, isClosed = false }: CrewCashFormProps) {
  const isEdit = !!entry;
  const needsReason = isClosed && !isEdit;
  const { mutate: create, isPending: isCreating } = useCreateCrewCash(sheetId);
  const { mutate: update, isPending: isUpdating } = useUpdateCrewCash(sheetId);
  const isPending = isCreating || isUpdating;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
    if (open && entry) {
      setForm({
        employeeId: entry.employeeId,
        category: entry.category,
        amount: entry.amount,
        notes: entry.notes ?? '',
      });
    } else if (open && !entry) {
      setForm(emptyForm);
    }
    // Only re-sync when the dialog transitions open, or the target entry changes
    // (e.g. tapping a different row while a stale form is still mounted) — a
    // quick-repeat reset inside handleSubmit deliberately does NOT re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);

  const isValid =
    !!form.employeeId && !!form.category && !!form.amount && form.amount > 0 &&
    (!needsReason || reason.trim().length >= 3);

  const handleSubmit = () => {
    if (!isValid || !form.category || !form.amount) return;

    if (isEdit && entry) {
      update(
        {
          id: entry.id,
          data: {
            version: entry.version,
            category: form.category,
            amount: form.amount,
            notes: form.notes.trim() || undefined,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }

    create(
      {
        employeeId: form.employeeId,
        category: form.category,
        amount: form.amount,
        notes: form.notes.trim() || undefined,
        ...(needsReason && { reason: reason.trim() }),
      },
      {
        onSuccess: () => {
          setForm((p) => ({ employeeId: '', category: p.category, amount: undefined, notes: '' }));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Crew Cash Entry' : isClosed ? 'Add Crew Cash (Closed Sheet)' : 'Add Crew Cash'}
          </DialogTitle>
        </DialogHeader>

        {needsReason && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
              This sheet is closed. The entry is posted to the employee&apos;s payroll ledger now and deducted
              from the day&apos;s cash hand-in; the close-time cash figure is left as it was and the change
              shows in the post-close divergence banner. A reason is required.
            </p>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Employee — dropdown: this sheet's crew first, then every other active employee. */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            <EmployeeSelect
              value={form.employeeId}
              onChange={(id) => setForm((p) => ({ ...p, employeeId: id }))}
              crew={employees}
              extra={entry?.employee ?? null}
              // An existing entry's recipient is its identity — only the correction flow can reassign it.
              disabled={isEdit}
            />
          </div>

          {/* Category — tappable chips, not a dropdown (doc §4/§13). */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Category <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {selectableCrewCashCategories(entry?.category).map((cat) => {
                const cfg = CREW_CASH_CATEGORY_CONFIG[cat];
                const Icon = cfg.icon;
                const selected = form.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, category: cat }))}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition-colors',
                      selected
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-background border-border/50 text-foreground hover:bg-muted',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[10px] font-bold leading-tight">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount — whole rupees only, defaults empty (matches adhoc-delivery-dialog convention). */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Amount (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="0"
              value={form.amount ?? ''}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  amount: e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)),
                }))
              }
              className="h-12 text-xl font-black font-mono"
            />
          </div>

          {/* Notes — optional, never required (doc §4/§13's "forgotten entries" risk). */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Notes</Label>
            <Input
              placeholder="Optional notes..."
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          {needsReason && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being added after the sheet closed?"
                rows={2}
                className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
              />
              {reason.trim().length < 3 && <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            {isEdit ? 'Cancel' : 'Done'}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isEdit ? 'Update' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
