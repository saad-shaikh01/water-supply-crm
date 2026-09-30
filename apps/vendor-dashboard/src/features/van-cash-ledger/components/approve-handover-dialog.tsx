'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
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
  const canSubmit = adjustedAmount !== '' && !Number.isNaN(parsedAmount) && parsedAmount >= 0
    && (!isAmountChanged || reason.trim().length > 0);

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
            {approveHandover.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
