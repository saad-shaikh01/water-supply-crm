'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Wallet, Link2 } from 'lucide-react';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';
import { CREATABLE_LEDGER_CATEGORIES, LEDGER_CATEGORY_CONFIG, LEDGER_CATEGORY_SIGN } from '../constants';
import { useCreateLedgerEntry, useCreateLinkedPenalty } from '../hooks/use-ledger-entry';
import { useEligibleEmployees } from '../hooks/use-eligible-employees';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { CustomerCombobox } from '../../customer-adjustments/components/customer-combobox';

/** Categories a customer link makes sense for — a bonus/advance/reimbursement etc. never has this shape. */
const LINKABLE_CATEGORIES: CreatableStaffLedgerCategory[] = ['PENALTY', 'DEDUCTION'];

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
  /** Fires after a successful create/linked-create, alongside the dialog's own close. */
  onSuccess?: () => void;
  /**
   * Suppresses the "Link to a customer" sub-flow regardless of permission — a linked
   * penalty is discovered via a different workflow (a customer complaint or cash
   * reconciliation) and stays an Employee Profile / customer-flow action, never a
   * Monthly Payroll one. Defaults to false (existing behavior) everywhere else.
   */
  disableCustomerLink?: boolean;
}

/**
 * The single "Log Ledger Entry" dialog behind every quick action in the module
 * (Log Advance, Log Expense/Reimbursement, Add Bonus, Add Penalty/Deduction) —
 * one row shape, category determines the rest, per the planning doc's "nine
 * categories, one row shape" philosophy.
 */
export function LogLedgerEntryDialog({
  open, onOpenChange, employee, defaultCategory, onSuccess, disableCustomerLink,
}: LogLedgerEntryDialogProps) {
  const { mutate: create, isPending: isCreatingPlain } = useCreateLedgerEntry();
  const { mutate: createLinked, isPending: isCreatingLinked } = useCreateLinkedPenalty();
  const { data: employees, isLoading: employeesLoading } = useEligibleEmployees();
  const { can } = usePermissions();
  const canLinkCustomer = can('customer_financial_adjustments:create_credit');

  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState<CreatableStaffLedgerCategory | undefined>(defaultCategory);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [sign, setSign] = useState<'credit' | 'debit' | undefined>(undefined);
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [description, setDescription] = useState('');

  // Linked Penalty (owner-approved 2026-09-25) — optional, only offered for
  // PENALTY/DEDUCTION and only to staff who can also post a customer credit.
  const [linkToCustomer, setLinkToCustomer] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerCreditTitle, setCustomerCreditTitle] = useState('');

  useEffect(() => {
    if (!open) return;
    setEmployeeId(employee?.id ?? '');
    setCategory(defaultCategory);
    setAmount(undefined);
    setSign(undefined);
    setEffectiveDate(todayIso());
    setDescription('');
    setLinkToCustomer(false);
    setCustomerId('');
    setCustomerCreditTitle('');
    // Only re-sync when the dialog transitions open — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const categoryMeta = category ? LEDGER_CATEGORY_CONFIG[category] : undefined;
  const isVariableSign = categoryMeta?.sign === 'variable';
  const canOfferLink = !disableCustomerLink && canLinkCustomer && !!category && LINKABLE_CATEGORIES.includes(category);
  const isLinked = canOfferLink && linkToCustomer;
  const isPending = isCreatingPlain || isCreatingLinked;

  const isValid =
    !!employeeId &&
    !!category &&
    !!amount &&
    amount > 0 &&
    (!isVariableSign || !!sign) &&
    (!isLinked || (!!customerId && !!customerCreditTitle.trim()));

  const handleSubmit = () => {
    if (!isValid || !category || !amount) return;

    const resolvedSign = isVariableSign ? (sign === 'credit' ? 1 : -1) : (LEDGER_CATEGORY_SIGN as Record<string, 1 | -1>)[category];
    const signedAmount = amount * resolvedSign;

    if (isLinked) {
      createLinked(
        {
          userId: employeeId,
          category: category as 'PENALTY' | 'DEDUCTION',
          amount: signedAmount,
          effectiveDate,
          description: description.trim() || undefined,
          customerId,
          customerCreditTitle: customerCreditTitle.trim(),
        },
        {
          onSuccess: () => {
            onOpenChange(false);
            onSuccess?.();
          },
        },
      );
      return;
    }

    create(
      {
        userId: employeeId,
        category,
        amount: signedAmount,
        effectiveDate,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSuccess?.();
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

          {canOfferLink && (
            <div className="space-y-3 rounded-xl border border-border/50 p-3">
              <button
                type="button"
                onClick={() => setLinkToCustomer((v) => !v)}
                className="flex items-center gap-2 text-xs font-bold"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                    linkToCustomer ? 'bg-primary border-primary' : 'border-border/60',
                  )}
                >
                  {linkToCustomer && <Link2 className="h-2.5 w-2.5 text-primary-foreground" />}
                </span>
                Link to a customer (optional)
              </button>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Use this when the reason is a customer's payment that was never recorded — the customer's
                balance is credited the same amount, atomically.
              </p>

              {linkToCustomer && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                      Customer <span className="text-destructive">*</span>
                    </Label>
                    <CustomerCombobox id="linked-penalty-customer" value={customerId} onChange={(id) => setCustomerId(id)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                      Customer credit reason <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      placeholder="e.g. Cash payment recorded late"
                      value={customerCreditTitle}
                      onChange={(e) => setCustomerCreditTitle(e.target.value)}
                      maxLength={120}
                    />
                    <p className="text-[11px] text-muted-foreground">Shown on the customer's statement.</p>
                  </div>
                </div>
              )}
            </div>
          )}
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
