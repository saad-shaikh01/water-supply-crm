'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Loader2, HandCoins } from 'lucide-react';
import { useCreateAdvancePlan } from '../hooks/use-advance-plans';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export interface NewAdvancePlanDialogProps {
  /** The dialog is visible whenever this is non-null (mirrors `SalaryStructureDialog`'s `employee` convention). */
  employee: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** Set when opened from the draft breakdown dialog's Advances tab, so its cached breakdown invalidates too. */
  entryId?: string;
}

/**
 * Turns a cash advance into an installment loan (owner-requested 2026-09-24):
 * the full principal is disbursed immediately (one `ADVANCE_DISBURSEMENT`
 * ledger entry — real cash out, same as a plain advance), then
 * `defaultInstallmentAmount` sizes each period's auto-generated recovery
 * installment going forward — an admin Collects (optionally a different
 * amount) or Skips (balance rolls into next period) each one from the
 * Advances tab. For a genuinely one-off advance with no repayment schedule,
 * `LogLedgerEntryDialog`'s plain "Log Advance" quick action still exists.
 */
export function NewAdvancePlanDialog({ employee, onOpenChange, entryId }: NewAdvancePlanDialogProps) {
  const { mutate: create, isPending } = useCreateAdvancePlan(entryId);

  const [principalAmount, setPrincipalAmount] = useState<number | undefined>(undefined);
  const [defaultInstallmentAmount, setDefaultInstallmentAmount] = useState<number | undefined>(undefined);
  const [disbursedAt, setDisbursedAt] = useState(todayIso());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!employee) return;
    setPrincipalAmount(undefined);
    setDefaultInstallmentAmount(undefined);
    setDisbursedAt(todayIso());
    setNote('');
    // Re-sync only when a different employee opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  const installmentCount =
    principalAmount && defaultInstallmentAmount && defaultInstallmentAmount > 0
      ? Math.ceil(principalAmount / defaultInstallmentAmount)
      : null;

  const isValid =
    !!employee &&
    !!principalAmount && principalAmount > 0 &&
    !!defaultInstallmentAmount && defaultInstallmentAmount > 0;

  const handleSubmit = () => {
    if (!isValid || !employee || !principalAmount || !defaultInstallmentAmount) return;
    create(
      {
        userId: employee.id,
        principalAmount,
        defaultInstallmentAmount,
        disbursedAt,
        note: note.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!employee} onOpenChange={(o) => !isPending && !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-primary" />
            New Advance Plan
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Employee</Label>
            <div className="h-10 px-3 flex items-center rounded-xl border border-border/50 bg-muted/40 text-sm font-semibold">
              {employee?.name}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Principal Amount (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 50000"
              value={principalAmount ?? ''}
              onChange={(e) => setPrincipalAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
              className="h-12 text-xl font-black font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Disbursed in full today — one cash-out entry, same as a plain advance.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Default Installment (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 10000"
              value={defaultInstallmentAmount ?? ''}
              onChange={(e) => setDefaultInstallmentAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
              className="h-12 text-xl font-black font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              {installmentCount != null
                ? `Roughly ${installmentCount} payroll period${installmentCount === 1 ? '' : 's'} to recover in full — skipping a period, or collecting a different amount, adjusts this automatically.`
                : 'Sizes each auto-generated installment — an admin can still skip a period or collect a different amount any time.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Disbursed On</Label>
            <Input type="date" value={disbursedAt} max={todayIso()} onChange={(e) => setDisbursedAt(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Note</Label>
            <Input placeholder="Optional note..." value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Disburse & Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
