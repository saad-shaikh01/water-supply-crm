'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Skeleton, Textarea,
} from '@water-supply-crm/ui';
import { AlertTriangle, Loader2, Lock } from 'lucide-react';
import { useForceCloseSheet, useForceClosePreview } from '../../hooks/use-daily-sheets';

interface ForceCloseDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

function rs(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

/**
 * Stale-sheet force close (admin tool). For an OPEN sheet from a previous day
 * that was never closed through the normal flow: PENDING stops are cancelled,
 * recorded stops are kept, the END vehicle check is waived (no odometer is
 * invented) and bottle/empty counts are accepted as recorded. Cash is closed
 * through the normal flow — it defaults to the sheet's expected hand-in, and
 * the admin can type what was REALLY handed in.
 */
export function ForceCloseDialog({ open, onClose, sheetId }: ForceCloseDialogProps) {
  const { data: preview, isLoading } = useForceClosePreview(sheetId, open);
  const { mutate: forceClose, isPending } = useForceCloseSheet(sheetId);
  const [reason, setReason] = useState('');
  const [cash, setCash] = useState('');

  useEffect(() => {
    if (preview) setCash(String(preview.cash.expectedHandIn));
  }, [preview]);

  const handleClose = () => { setReason(''); onClose(); };

  const reasonOk = reason.trim().length >= 5;
  const cashNumber = cash === '' ? NaN : Number(cash);
  const cashOk = Number.isFinite(cashNumber) && cashNumber >= 0;
  const canSubmit = !!preview?.eligible && reasonOk && cashOk && !isPending;
  const cashDiffers = preview && cashOk && cashNumber !== preview.cash.expectedHandIn;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Lock className="h-5 w-5 text-destructive" />
            Close Stale Sheet
          </DialogTitle>
        </DialogHeader>

        {isLoading && <Skeleton className="h-48 rounded-2xl" />}

        {preview && (
          <div className="space-y-4 py-1 text-sm">
            <p className="text-muted-foreground">
              {new Date(preview.date).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' })}
              {preview.vanPlateNumber && ` · ${preview.vanPlateNumber}`}
              {preview.driverName && ` · ${preview.driverName}`}
              {preview.kind === 'WALK_IN' && ' · Walk-in'}
            </p>

            {!preview.eligible && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
                <span>{preview.ineligibleReason}</span>
              </div>
            )}

            <div className="rounded-2xl border border-border p-3 space-y-1.5">
              <div className="flex justify-between"><span>Recorded deliveries (kept)</span><span className="font-bold">{preview.recordedCount}</span></div>
              <div className="flex justify-between">
                <span>Pending deliveries (will be cancelled)</span>
                <span className="font-bold">{preview.pendingCount}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Bottles delivered / empties collected</span>
                <span>{preview.bottles.delivered} / {preview.bottles.emptiesCollected}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border p-3 space-y-1.5">
              <div className="flex justify-between"><span>Cash recorded on deliveries</span><span className="font-bold">{rs(preview.cash.deliveryCashRecorded)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>− Paid from the van</span><span>{rs(preview.cash.vanExpenses)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>− Crew cash</span><span>{rs(preview.cash.crewCash)}</span></div>
              <div className="flex justify-between border-t pt-1.5"><span>Expected hand-in</span><span className="font-bold">{rs(preview.cash.expectedHandIn)}</span></div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="force-close-cash">Cash actually handed in (₨)</Label>
              <Input
                id="force-close-cash"
                type="number"
                min={0}
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                className="rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                Pre-filled with the expected hand-in (no cash discrepancy). If the money never reached the office, enter what
                did — the difference is raised as a normal cash discrepancy case.
              </p>
              {cashDiffers && (
                <p className="text-xs text-amber-600">
                  Differs from expected by {rs(Math.abs(preview.cash.expectedHandIn - cashNumber))} — a cash discrepancy case will be created.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="force-close-reason">Reason (required, saved in the audit log)</Label>
              <Textarea
                id="force-close-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Sheet was never closed in September; entries verified with the driver"
                className="rounded-xl"
                rows={2}
              />
            </div>

            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
              {preview.vehicleCheck.required && !preview.vehicleCheck.endCheckRecorded && (
                <li>The end-of-day vehicle check is waived — no odometer reading is recorded for this day.</li>
              )}
              <li>Bottle and empty counts are accepted as recorded (no stock discrepancy case).</li>
              <li>The cash goes to the Cash Ledger as a pending handover for the office to approve, as usual.</li>
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={handleClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            className="rounded-xl font-bold"
            disabled={!canSubmit}
            onClick={() =>
              forceClose(
                { reason: reason.trim(), actualCashHandedIn: cashNumber },
                { onSuccess: handleClose },
              )
            }
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Close sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
