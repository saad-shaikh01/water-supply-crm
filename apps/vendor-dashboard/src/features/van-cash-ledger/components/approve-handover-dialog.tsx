'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../constants';
import { useApproveHandover } from '../hooks/use-van-cash-ledger';

/**
 * Normalized shape both the Timeline row's Approve button (`CashLedgerRow`)
 * and the Pending Approvals panel (`PendingHandover`) map into before opening
 * this dialog — the two read endpoints project the same underlying
 * `VanCashHandover` with different field names, so this is the one place the
 * dialog needs to understand.
 */
export interface HandoverApprovalTarget {
  /** The `VanCashHandover` id — PATCH target. */
  sourceRecordId: string;
  dailySheetId: string | null;
  vanPlateNumber: string | null;
  driverName: string | null;
  date: string;
  /** The originally handed-over (revenue) amount. */
  amount: number;
  /** Customer-deposit cash handed over with it — recognized in the ledger on approval. */
  depositCash?: number;
  /** Short-approved earlier — held for an approve_shortfall holder; nothing is posted yet. */
  onHold?: boolean;
  heldAmount?: number | null;
  heldReason?: string | null;
  heldByName?: string | null;
  /** Optimistic-concurrency token — now surfaced by both read endpoints. */
  version: number;
}

interface ApproveHandoverDialogProps {
  target: HandoverApprovalTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

export function ApproveHandoverDialog({ target, open, onOpenChange }: ApproveHandoverDialogProps) {
  const approveHandover = useApproveHandover();
  const canApproveShortfall = useCan(VAN_CASH_LEDGER_PERMISSIONS.approveShortfall);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && target) {
      setAdjustedAmount(String(target.amount));
      setReason('');
    }
  }, [open, target]);

  if (!target) return null;

  const parsedAmount = Number(adjustedAmount);
  const isAmountChanged = adjustedAmount !== '' && !Number.isNaN(parsedAmount) && parsedAmount !== target.amount;
  const isShort = isAmountChanged && parsedAmount < target.amount;
  const isOver = isAmountChanged && parsedAmount > target.amount;
  const onHold = !!target.onHold;
  // Without approve_shortfall a reduction is not posted — it is held for an admin — and a
  // row that is already held cannot be touched at all.
  const willHold = isShort && !canApproveShortfall;
  const blockedByHold = onHold && !canApproveShortfall;
  const canSubmit = adjustedAmount !== '' && !Number.isNaN(parsedAmount) && parsedAmount >= 0
    && (!isAmountChanged || reason.trim().length > 0) && !blockedByHold;

  const handleApprove = () => {
    if (!canSubmit) return;
    approveHandover.mutate(
      {
        id: target.sourceRecordId,
        data: {
          version: target.version,
          approvedAmount: isAmountChanged ? parsedAmount : undefined,
          adjustmentReason: isAmountChanged ? reason.trim() : undefined,
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
            Approve Cash Handover
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</p>
              <p className="font-semibold">{fmtDate(target.date)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Van</p>
              <p className="font-semibold font-mono">{target.vanPlateNumber ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Driver</p>
              <p className="font-semibold">{target.driverName ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Handed Over</p>
              <p className="font-mono font-black text-emerald-500">₨ {target.amount.toLocaleString()}</p>
            </div>
          </div>

          {(target.depositCash ?? 0) > 0 && (
            <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 px-3 py-2 text-[11px] space-y-0.5">
              <p className="font-bold text-violet-600">
                + ₨ {(target.depositCash ?? 0).toLocaleString()} customer deposit cash
              </p>
              <p className="text-muted-foreground">
                Physical total to receive: ₨ {(target.amount + (target.depositCash ?? 0)).toLocaleString()}. The deposit is
                added to the Cash Ledger when you approve; the Approved Amount below adjusts the revenue part only.
              </p>
            </div>
          )}

          {onHold && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-[11px] space-y-1.5">
              <p className="font-bold text-amber-600 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                On hold — short-approved, nothing is in the Cash Ledger yet
              </p>
              <p className="text-muted-foreground">
                {target.heldByName ?? 'An approver'} proposed{' '}
                <span className="font-mono font-bold text-foreground">₨ {(target.heldAmount ?? 0).toLocaleString()}</span>{' '}
                instead of <span className="font-mono font-bold text-foreground">₨ {target.amount.toLocaleString()}</span>
                {target.heldReason ? <> — “{target.heldReason}”</> : null}. Missing:{' '}
                <span className="font-mono font-bold text-destructive">
                  ₨ {(target.amount - (target.heldAmount ?? 0)).toLocaleString()}
                </span>.
              </p>
              {canApproveShortfall ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[11px] font-bold"
                    onClick={() => { setAdjustedAmount(String(target.amount)); setReason(''); }}
                  >
                    Approve full ₨ {target.amount.toLocaleString()}
                  </Button>
                  <Button
                    type="button" size="sm" variant="outline" className="h-7 rounded-lg text-[11px] font-bold"
                    onClick={() => {
                      setAdjustedAmount(String(target.heldAmount ?? 0));
                      setReason(target.heldReason ?? '');
                    }}
                  >
                    Approve reduced ₨ {(target.heldAmount ?? 0).toLocaleString()}
                  </Button>
                </div>
              ) : (
                <p className="font-semibold text-amber-600">
                  Only someone with the “release short-approved handover” permission (Admin) can approve this now.
                </p>
              )}
            </div>
          )}

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
              Leave unchanged to approve the handed-over amount as-is.
            </p>
          </div>

          {isOver && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-3 py-2 text-[11px] flex gap-2">
              <TriangleAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-destructive font-semibold">
                You are approving ₨ {(parsedAmount - target.amount).toLocaleString()} MORE than what was handed over
                (₨ {target.amount.toLocaleString()}). The extra amount will be added to the Cash Ledger and flagged on the entry.
              </p>
            </div>
          )}

          {isShort && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] flex gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-700 font-semibold">
                {willHold
                  ? `₨ ${(target.amount - parsedAmount).toLocaleString()} short. This will NOT be added to the Cash Ledger — the handover is put on hold for an admin to investigate and approve.`
                  : `₨ ${(target.amount - parsedAmount).toLocaleString()} short. Only ₨ ${parsedAmount.toLocaleString()} will be added to the Cash Ledger — the reason is recorded on the entry.`}
              </p>
            </div>
          )}

          {isAmountChanged && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Adjustment Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why does the approved amount differ from what was handed over?"
                className="rounded-xl min-h-20"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleApprove}
            disabled={!canSubmit || approveHandover.isPending}
            className="rounded-xl font-bold"
          >
            {approveHandover.isPending ? 'Approving…' : willHold ? 'Put on hold' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
