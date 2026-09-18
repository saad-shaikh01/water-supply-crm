'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Wallet } from 'lucide-react';
import type { CrewCashCategory } from '@water-supply-crm/types';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';
import { CREW_CASH_CATEGORIES, CREW_CASH_CATEGORY_CONFIG } from '../constants';
import { useCreateStandaloneCrewCash } from '../hooks/use-crew-cash';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface StandaloneCrewCashFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  employeeId: string;
  category: CrewCashCategory | undefined;
  amount: number | undefined;
  date: string;
  notes: string;
}

const emptyForm: FormState = { employeeId: '', category: undefined, amount: undefined, date: todayIso(), notes: '' };

/**
 * Crew Cash recorded WITHOUT a Daily Sheet (owner-requested 2026-09-18) —
 * reached from the Add-Expense wizard when Crew Cash is picked but no open
 * route sheet is chosen (see `SheetPickerDialog`'s `optional` prop and
 * `AddExpenseWizard`'s `crew-cash-standalone` stage). Same category chips +
 * amount keypad as the sheet-scoped `CrewCashForm`, but the employee picker
 * is the full active-staff list (`useEligibleEmployees`, same list
 * `LogLedgerEntryDialog` uses for Advance/Bonus/etc) rather than "today's
 * confirmed crew" — there is no sheet here to scope it to — and `date` is a
 * real field instead of inherited from a sheet.
 */
export function StandaloneCrewCashForm({ open, onOpenChange }: StandaloneCrewCashFormProps) {
  const { mutate: create, isPending } = useCreateStandaloneCrewCash();
  const { data: employees, isLoading: employeesLoading } = useEligibleEmployees();

  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
    // Only re-sync when the dialog transitions open — a quick-repeat reset
    // inside handleSubmit deliberately does NOT re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isValid = !!form.employeeId && !!form.category && !!form.amount && form.amount > 0 && !!form.date;

  const handleSubmit = () => {
    if (!isValid || !form.category || !form.amount) return;

    create(
      {
        employeeId: form.employeeId,
        category: form.category,
        amount: form.amount,
        date: form.date,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setForm((p) => ({ ...p, employeeId: '', amount: undefined, notes: '' }));
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
            Add Crew Cash (No Sheet)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            <Select value={form.employeeId} onValueChange={(v) => setForm((p) => ({ ...p, employeeId: v }))} disabled={employeesLoading}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={employeesLoading ? 'Loading employees…' : 'Select employee'} />
              </SelectTrigger>
              <SelectContent>
                {(employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                    <span className="ml-1 text-xs text-muted-foreground">({e.role.toLowerCase()})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={form.date}
              max={todayIso()}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className="h-10"
            />
          </div>

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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Done</Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
