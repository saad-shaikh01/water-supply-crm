'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Wallet } from 'lucide-react';
import type { CrewCashEntry } from '@water-supply-crm/types';
import { CREW_CASH_CATEGORIES, CREW_CASH_CATEGORY_CONFIG } from '../constants';
import { useCreateCrewCash, useUpdateCrewCash } from '../hooks/use-crew-cash';

export interface CrewCashEmployeeOption {
  id: string;
  name: string;
}

interface CrewCashFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string;
  /** Today's confirmed crew only (driver + DailySheetCrew) — doc §4/§13, never the full staff directory. */
  employees: CrewCashEmployeeOption[];
  /** Present in edit mode; absent for a fresh add. */
  entry?: CrewCashEntry | null;
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
export function CrewCashForm({ open, onOpenChange, sheetId, employees, entry }: CrewCashFormProps) {
  const isEdit = !!entry;
  const { mutate: create, isPending: isCreating } = useCreateCrewCash(sheetId);
  const { mutate: update, isPending: isUpdating } = useUpdateCrewCash(sheetId);
  const isPending = isCreating || isUpdating;

  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
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

  const isValid = !!form.employeeId && !!form.category && !!form.amount && form.amount > 0;

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
            {isEdit ? 'Edit Crew Cash Entry' : 'Add Crew Cash'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Employee — tappable list, scoped to today's confirmed crew only (doc §13). */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            {employees.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, employeeId: emp.id }))}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm font-bold border transition-colors',
                      form.employeeId === emp.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border/50 text-foreground hover:bg-muted',
                    )}
                  >
                    {emp.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">No confirmed crew for this sheet yet.</p>
            )}
          </div>

          {/* Category — tappable chips, not a dropdown (doc §4/§13). */}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Category <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {CREW_CASH_CATEGORIES.map((cat) => {
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
