'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Skeleton,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Landmark, ArrowRight, Clock3 } from 'lucide-react';
import { useEffectiveSalaryStructure } from '../hooks/use-employee-profile';
import { useCreateSalaryStructure } from '../hooks/use-salary-structure';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** `effectiveFrom` must be strictly after this date — one day past it, ISO `yyyy-mm-dd`. */
function dayAfterIso(iso: string) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface SalaryStructureDialogProps {
  /** The dialog is visible whenever this is non-null (mirrors `SettlementDialog`'s `entryId` convention). */
  employee: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful create, in addition to the hook's own cache invalidation/toast — lets a
   * caller (e.g. the Monthly Payroll missing-salary banner) drop that employee from its own local list. */
  onSuccess?: (employeeId: string) => void;
}

/**
 * Starts a new versioned Salary Structure for one employee (Payroll Doc §4/§8 item 4) — either
 * the employee's first ("Set Salary") or a new version superseding their current one ("Update
 * Salary"), never an in-place edit. Always launched with a known employee (from the Employee
 * Financial Profile's own card, or from the Monthly Payroll missing-salary-structure banner) —
 * there is no employee picker here, unlike `LogLedgerEntryDialog`.
 */
export function SalaryStructureDialog({ employee, onOpenChange, onSuccess }: SalaryStructureDialogProps) {
  const { data: current, isLoading: currentLoading } = useEffectiveSalaryStructure(employee?.id ?? '');
  const { mutate: create, isPending } = useCreateSalaryStructure();

  const [baseAmount, setBaseAmount] = useState<number | undefined>(undefined);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());

  useEffect(() => {
    if (!employee) return;
    setBaseAmount(undefined);
    setEffectiveFrom(todayIso());
    // Only re-sync when a different employee opens — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  const isUpdate = !!current;
  const minEffectiveFrom = current ? dayAfterIso(current.effectiveFrom) : undefined;
  const dateError = current && effectiveFrom <= current.effectiveFrom
    ? `Must be after ${formatDate(current.effectiveFrom)} — the current structure's start date.`
    : null;
  const isFutureDated = effectiveFrom > todayIso();

  const diff = current && baseAmount != null ? baseAmount - current.baseAmount : null;
  const diffPercent = diff != null && current && current.baseAmount > 0 ? (diff / current.baseAmount) * 100 : null;

  const isValid = !!employee && !!baseAmount && baseAmount > 0 && !dateError;

  const handleSubmit = () => {
    if (!isValid || !employee || !baseAmount) return;
    create(
      { userId: employee.id, baseAmount, effectiveFrom },
      { onSuccess: () => { onOpenChange(false); onSuccess?.(employee.id); } },
    );
  };

  return (
    <Dialog open={!!employee} onOpenChange={(o) => !isPending && !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Landmark className="h-5 w-5 text-primary" />
            {isUpdate ? 'Update Salary' : 'Set Salary'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Employee</Label>
            <div className="h-10 px-3 flex items-center rounded-xl border border-border/50 bg-muted/40 text-sm font-semibold">
              {employee?.name}
            </div>
          </div>

          {/* Live Current → New → Difference summary */}
          {currentLoading ? (
            <Skeleton className="h-20 w-full rounded-2xl" />
          ) : (
            <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current</p>
                  <p className="font-mono font-black text-lg">
                    {current ? `₨ ${current.baseAmount.toLocaleString()}` : '—'}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">New</p>
                  <p className="font-mono font-black text-lg">
                    {baseAmount ? `₨ ${baseAmount.toLocaleString()}` : '—'}
                  </p>
                </div>
              </div>

              {diff != null && (
                <div
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-xl',
                    diff > 0 ? 'bg-emerald-500/10' : diff < 0 ? 'bg-destructive/10' : 'bg-muted',
                  )}
                >
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Difference</span>
                  <span
                    className={cn(
                      'font-mono font-bold text-sm',
                      diff > 0 ? 'text-emerald-500' : diff < 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {diff > 0 ? '+' : diff < 0 ? '−' : ''}₨ {Math.abs(diff).toLocaleString()}
                    {diffPercent != null && ` (${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diffPercent).toFixed(1)}%)`}
                  </span>
                </div>
              )}

              {!current && (
                <p className="text-xs text-muted-foreground">No active salary structure yet — this will be their first.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Base Amount (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={1}
              step={1}
              placeholder="0"
              value={baseAmount ?? ''}
              onChange={(e) => setBaseAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
              className="h-12 text-xl font-black font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Effective From</Label>
            <Input
              type="date"
              value={effectiveFrom}
              min={minEffectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="h-10"
            />
            {dateError && <p className="text-xs text-destructive">{dateError}</p>}
            {!dateError && isFutureDated && (
              <p className="text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5 shrink-0" />
                This salary will become active on {formatDate(effectiveFrom)}.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isUpdate ? 'Record Update' : 'Set Salary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
