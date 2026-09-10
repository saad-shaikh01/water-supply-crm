'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, TriangleAlert } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { useApproveRemittance, useCashLedgerStats } from '../hooks/use-van-cash-ledger';

/**
 * Normalized shape both the Timeline row (`CashLedgerRow`) and the Pending
 * Owner Handovers panel (`PendingRemittance`) map into before opening this
 * dialog — mirrors `HandoverApprovalTarget`.
 */
export interface RemittanceApprovalTarget {
  /** The `OfficeCashRemittance` id — PATCH target. */
  sourceRecordId: string;
  date: string;
  amount: number;
  destinationLabel: string;
  submittedByName: string | null;
  /** Optimistic-concurrency token. */
  version: number;
}

interface ApproveRemittanceDialogProps {
  target: RemittanceApprovalTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

const money = (n: number) => `₨ ${Number(n ?? 0).toLocaleString()}`;

export function ApproveRemittanceDialog({ target, open, onOpenChange }: ApproveRemittanceDialogProps) {
  const approveRemittance = useApproveRemittance();
  const { data: stats } = useCashLedgerStats();
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    if (open && target) {
      setAdjustedAmount(String(target.amount));
      setReason('');
      setOverrideReason('');
    }
  }, [open, target]);

  if (!target) return null;

  const parsedAmount = Number(adjustedAmount);
  const amountValid = adjustedAmount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const isAmountChanged = amountValid && parsedAmount !== target.amount;

  const available = stats?.availableBalance ?? 0;
  const projected = available - (amountValid ? parsedAmount : target.amount);
  const wouldGoNegative = projected < 0;

  const canSubmit =
    amountValid &&
    (!isAmountChanged || reason.trim().length > 0) &&
    (!wouldGoNegative || overrideReason.trim().length > 0);

  const handleApprove = () => {
    if (!canSubmit) return;
    approveRemittance.mutate(
      {
        id: target.sourceRecordId,
        data: {
          version: target.version,
          approvedAmount: isAmountChanged ? parsedAmount : undefined,
          adjustmentReason: isAmountChanged ? reason.trim() : undefined,
          negativeOverrideReason: wouldGoNegative ? overrideReason.trim() : undefined,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-primary" />
            Approve Owner Handover
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</p>
              <p className="font-semibold">{fmtDate(target.date)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">To</p>
              <p className="font-semibold">{target.destinationLabel}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recorded by</p>
              <p className="font-semibold">{target.submittedByName ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Amount</p>
              <p className="font-mono font-black text-violet-500">₨ {target.amount.toLocaleString()}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Approved Amount
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={adjustedAmount}
              onChange={(e) => setAdjustedAmount(e.target.value)}
              className="h-10 rounded-xl"
            />
            <p className="text-[11px] text-muted-foreground">
              Leave unchanged to approve the recorded amount as-is.
            </p>
          </div>

          {isAmountChanged && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Adjustment Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why does the approved amount differ from what was recorded?"
                className="rounded-xl min-h-16"
              />
            </div>
          )}

          {wouldGoNegative && (
            <div className="space-y-2">
              <div className="flex gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-destructive">
                <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Approving this drives office cash to{' '}
                  <span className="font-bold">{money(projected)}</span>. A reason is required to proceed.
                </p>
              </div>
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Negative-balance Override Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. a van handover is still pending entry"
                className="rounded-xl min-h-16"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleApprove}
            disabled={!canSubmit || approveRemittance.isPending}
            className="rounded-xl font-bold"
          >
            {approveRemittance.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
