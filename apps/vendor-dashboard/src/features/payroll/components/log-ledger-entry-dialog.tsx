'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Wallet } from 'lucide-react';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';
import { CREATABLE_LEDGER_CATEGORIES, LEDGER_CATEGORY_CONFIG, LEDGER_CATEGORY_SIGN } from '../constants';
import { useCreateLedgerEntry } from '../hooks/use-ledger-entry';
import { useEligibleEmployees } from '../hooks/use-eligible-employees';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export interface LogLedgerEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled and locked when launched from that employee's own Financial Profile. */
  employee?: { id: string; name: string } | null;
  /** Pre-selected starting category for the quick-action button that opened this dialog (still editable). */
  defaultCategory?: CreatableStaffLedgerCategory;
}

/**
 * The single "Log Ledger Entry" dialog behind every quick action in the module
 * (Log Advance, Log Expense/Reimbursement, Add Bonus, Add Penalty/Deduction) —
 * one row shape, category determines the rest, per the planning doc's "nine
 * categories, one row shape" philosophy.
 */
export function LogLedgerEntryDialog({ open, onOpenChange, employee, defaultCategory }: LogLedgerEntryDialogProps) {
  const { mutate: create, isPending } = useCreateLedgerEntry();
  const { data: employees, isLoading: employeesLoading } = useEligibleEmployees();

  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState<CreatableStaffLedgerCategory | undefined>(defaultCategory);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [sign, setSign] = useState<'credit' | 'debit' | undefined>(undefined);
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setEmployeeId(employee?.id ?? '');
    setCategory(defaultCategory);
    setAmount(undefined);
    setSign(undefined);
    setEffectiveDate(todayIso());
    setDescription('');
    // Only re-sync when the dialog transitions open — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const categoryMeta = category ? LEDGER_CATEGORY_CONFIG[category] : undefined;
  const isVariableSign = categoryMeta?.sign === 'variable';

  const isValid =
    !!employeeId &&
    !!category &&
    !!amount &&
    amount > 0 &&
    (!isVariableSign || !!sign);

  const handleSubmit = () => {
    if (!isValid || !category || !amount) return;

    const resolvedSign = isVariableSign ? (sign === 'credit' ? 1 : -1) : (LEDGER_CATEGORY_SIGN as Record<string, 1 | -1>)[category];

    create(
      {
        userId: employeeId,
        category,
        amount: amount * resolvedSign,
        effectiveDate,
        description: description.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Log Ledger Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            {employee ? (
              <div className="h-10 px-3 flex items-center rounded-xl border border-border/50 bg-muted/40 text-sm font-semibold">
                {employee.name}
              </div>
            ) : (
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={employeesLoading}>
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
            )}
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CreatableStaffLedgerCategory)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_LEDGER_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {LEDGER_CATEGORY_CONFIG[cat].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isVariableSign && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Direction <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSign('credit')}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-sm font-bold transition-colors',
                    sign === 'credit'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600'
                      : 'bg-background border-border/50 text-foreground hover:bg-muted',
                  )}
                >
                  Credit (owed to employee)
                </button>
                <button
                  type="button"
                  onClick={() => setSign('debit')}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-sm font-bold transition-colors',
                    sign === 'debit'
                      ? 'bg-destructive/10 border-destructive text-destructive'
                      : 'bg-background border-border/50 text-foreground hover:bg-muted',
                  )}
                >
                  Debit (owed by employee)
                </button>
              </div>
            </div>
          )}

          {category && !isVariableSign && (
            <p className="text-xs text-muted-foreground -mt-1">
              {categoryMeta?.sign === 1
                ? 'This will be added to the employee\'s pay.'
                : 'This will be deducted from the employee\'s pay.'}
            </p>
          )}

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
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Effective Date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Description</Label>
            <Input
              placeholder="Optional reason / note..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
