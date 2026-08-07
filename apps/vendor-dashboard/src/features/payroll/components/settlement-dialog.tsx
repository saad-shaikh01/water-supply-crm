'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Loader2, Landmark, CheckCircle2 } from 'lucide-react';
import type { SettlementMethod } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useCrewCandidates } from '../../users/hooks/use-users';
import { useEntryBreakdown } from '../hooks/use-monthly-payroll';
import { useEntrySettlements, useRecordSettlement, useMarkSettled } from '../hooks/use-settlement';

const SETTLEMENT_METHODS: Array<{ value: SettlementMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
];

function formatDateTime(d: string) {
  return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface SettlementDialogProps {
  entryId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Settlement page (§7): reached from a LOCKED (or already partially SETTLED)
 * PayrollEntry — record payment method/amount/reference, live remaining balance
 * as the amount is typed, plus the entry's settlement history. Reuses
 * `useEntryBreakdown` (already fetches the full entry + its `version`, needed
 * for `mark-settled`'s optimistic-concurrency check) instead of threading a
 * possibly-stale row object in from the table, matching `EntryBreakdownDialog`'s
 * fetch-fresh-by-id convention.
 */
export function SettlementDialog({ entryId, onOpenChange }: SettlementDialogProps) {
  const { can } = usePermissions();
  const canRecord = can('payroll:settlement_record');

  const { data: breakdown, isLoading: entryLoading, isError: entryError } = useEntryBreakdown(entryId ?? undefined);
  const { data: settlementData, isLoading: settlementsLoading, isError: settlementsError } = useEntrySettlements(entryId ?? undefined);
  const { data: usersPage } = useCrewCandidates();

  const { mutate: recordSettlement, isPending: isRecording } = useRecordSettlement(
    entryId ?? undefined,
    breakdown?.entry.periodId,
  );
  const { mutate: markSettled, isPending: isMarkingSettled } = useMarkSettled(
    entryId ?? undefined,
    breakdown?.entry.periodId,
  );

  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [referenceNote, setReferenceNote] = useState('');

  useEffect(() => {
    if (!entryId) return;
    setAmount(undefined);
    setMethod('CASH');
    setReferenceNote('');
    // Only re-sync when a different entry opens — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const userNameById = new Map<string, string>((usersPage?.data ?? []).map((u) => [u.id, u.name]));

  const isLoading = entryLoading || settlementsLoading;
  const isError = entryError || settlementsError || !breakdown || !settlementData;

  const canSettleThisEntry = breakdown?.entry.status === 'LOCKED' || breakdown?.entry.status === 'SETTLED';
  // Live remaining balance (§7): server's remainingBalance minus whatever the
  // user is currently typing — deliberately allowed to go negative (overpayment)
  // or stay positive (partial payment), never clamped either direction.
  const remainingBalance = settlementData ? settlementData.remainingBalance - (amount ?? 0) : undefined;

  const isValid = !!amount && amount > 0;

  const handleRecord = () => {
    if (!isValid || !amount) return;
    recordSettlement(
      { amount, method, referenceNote: referenceNote.trim() || undefined },
      {
        onSuccess: () => {
          setAmount(undefined);
          setReferenceNote('');
        },
      },
    );
  };

  const handleMarkSettled = () => {
    if (!breakdown) return;
    markSettled(breakdown.entry.version);
  };

  return (
    <Dialog open={!!entryId} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Landmark className="h-5 w-5 text-primary" />
            Settlement
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load this entry's settlement details.
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-lg font-bold">{breakdown.entry.user.name}</p>
                <p className="text-xs text-muted-foreground">{breakdown.entry.period.periodLabel}</p>
              </div>
              <StatusBadge status={breakdown.entry.status} />
            </div>

            <div className="rounded-2xl border border-border/50 bg-muted/20 divide-y divide-border/50">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-muted-foreground">Final Payable</span>
                <span className="font-mono font-bold">₨ {breakdown.entry.finalPayable.toLocaleString()}</span>
              </div>
              <div
                className={cn(
                  'flex items-center justify-between px-4 py-3.5 rounded-b-2xl',
                  (remainingBalance ?? 0) > 0
                    ? 'bg-destructive/10'
                    : (remainingBalance ?? 0) < 0
                      ? 'bg-emerald-500/10'
                      : 'bg-primary/5',
                )}
              >
                <span className="text-sm font-black uppercase tracking-widest">Remaining Balance</span>
                <span
                  className={cn(
                    'font-mono font-black text-lg',
                    (remainingBalance ?? 0) > 0
                      ? 'text-destructive'
                      : (remainingBalance ?? 0) < 0
                        ? 'text-emerald-500'
                        : 'text-foreground',
                  )}
                >
                  {(remainingBalance ?? 0) < 0 ? '−' : ''}₨ {Math.abs(remainingBalance ?? 0).toLocaleString()}
                </span>
              </div>
            </div>

            {!canSettleThisEntry ? (
              <p className="text-xs text-muted-foreground">
                Settlements can only be recorded against a LOCKED or SETTLED entry.
              </p>
            ) : canRecord ? (
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Record Payment</h3>

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
                  <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Method</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as SettlementMethod)}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SETTLEMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Reference / Note</Label>
                  <Input
                    placeholder="Optional reference or note..."
                    value={referenceNote}
                    onChange={(e) => setReferenceNote(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleRecord} disabled={isRecording || !isValid} className="rounded-xl font-bold gap-2">
                    {isRecording ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Record Payment
                  </Button>
                  {breakdown.entry.status === 'LOCKED' && (
                    <Button
                      variant="outline"
                      onClick={handleMarkSettled}
                      disabled={isMarkingSettled}
                      className="rounded-xl font-bold gap-2"
                    >
                      {isMarkingSettled ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Mark as Settled
                    </Button>
                  )}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Settlement History</h3>
              {settlementData.settlements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No settlements recorded yet.</p>
              ) : (
                <div className="rounded-xl border border-border/40 divide-y divide-border/40 overflow-hidden">
                  {settlementData.settlements.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-semibold">
                          {SETTLEMENT_METHODS.find((m) => m.value === s.method)?.label ?? s.method}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">{formatDateTime(s.paidAt)}</span>
                        <p className="text-xs text-muted-foreground truncate">
                          Recorded by {userNameById.get(s.paidById) ?? 'Unknown'}
                          {s.referenceNote ? ` — ${s.referenceNote}` : ''}
                        </p>
                      </div>
                      <span className="font-mono font-bold shrink-0 text-emerald-500">₨ {s.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
