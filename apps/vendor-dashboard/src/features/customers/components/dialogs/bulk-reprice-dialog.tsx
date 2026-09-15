'use client';

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { AlertTriangle, ArrowLeft, Tag } from 'lucide-react';
import { useBulkRepriceClosedDeliveries } from '../../../daily-sheets/hooks/use-daily-sheets';

function fmtRs(n: number) {
  const sign = n < 0 ? '-' : '';
  return `${sign}Rs.${Math.abs(Math.round(n)).toLocaleString('en-PK')}`;
}

export interface BulkRepriceRow {
  dailySheetItemId: string;
  date: string;
  btlDelivered: number;
  pricePerBottle: number;
}

interface BulkRepriceDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
  /** The selected, repriceable Delivery History rows — one per closed delivery. */
  rows: BulkRepriceRow[];
}

/**
 * Bulk Closed Delivery Repricing — retroactive rate change (management-
 * approved) applied to several closed deliveries for one customer at once.
 * Deliberately a SEPARATE flow from the per-item "Correct Closed-Sheet
 * Delivery" dialog: this never touches quantities, only the rate, and is for
 * a business decision (a customer stayed on an old rate), not a driver
 * mistake. Two-step form -> confirm, mirroring adjust-bottle-wallet-dialog.tsx.
 */
export function BulkRepriceDialog({ open, onClose, customerId, rows }: BulkRepriceDialogProps) {
  const { mutate: bulkReprice, isPending } = useBulkRepriceClosedDeliveries(customerId);
  const [newRate, setNewRate] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  const newRateNum = Number(newRate);
  const rateValid = newRate.trim() !== '' && Number.isFinite(newRateNum) && newRateNum >= 0;
  const reasonValid = reason.trim().length >= 3;
  const canReview = rateValid && reasonValid && rows.length > 0;

  const preview = useMemo(
    () =>
      rows.map((r) => {
        const oldAmount = r.btlDelivered * r.pricePerBottle;
        const newAmount = r.btlDelivered * (rateValid ? newRateNum : r.pricePerBottle);
        return { ...r, oldAmount, newAmount, difference: newAmount - oldAmount };
      }),
    [rows, rateValid, newRateNum],
  );
  const totalDifference = preview.reduce((s, r) => s + r.difference, 0);

  const handleClose = () => {
    setNewRate('');
    setReason('');
    setStep('form');
    onClose();
  };

  const handleConfirm = () => {
    bulkReprice(
      {
        dailySheetItemIds: rows.map((r) => r.dailySheetItemId),
        newPricePerBottle: newRateNum,
        reason: reason.trim(),
      },
      { onSuccess: handleClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-lg bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            {step === 'form' ? 'Bulk Reprice Deliveries' : 'Confirm Repricing'}
          </DialogTitle>
        </DialogHeader>

        {step === 'form' ? (
          <>
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                  This applies to {rows.length} closed deliver{rows.length === 1 ? 'y' : 'ies'} for this customer.
                  Quantities are not changed — only the rate. The customer&apos;s balance and every report update
                  to reflect the new rate; the sheet&apos;s already-approved cash figures are left untouched.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">New rate / bottle</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 200"
                  className="h-11 font-mono font-bold"
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                />
              </div>

              <div className="rounded-xl border border-border/50 overflow-hidden">
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/50">
                      <tr className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-right px-3 py-2">Qty</th>
                        <th className="text-right px-3 py-2">Old Rate</th>
                        <th className="text-right px-3 py-2">New Amt</th>
                        <th className="text-right px-3 py-2">Diff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {preview.map((r) => (
                        <tr key={r.dailySheetItemId}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.btlDelivered}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmtRs(r.pricePerBottle)}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-bold">{rateValid ? fmtRs(r.newAmount) : '—'}</td>
                          <td className={`px-3 py-1.5 text-right font-mono font-bold ${r.difference < 0 ? 'text-emerald-600' : r.difference > 0 ? 'text-rose-500' : ''}`}>
                            {rateValid ? (r.difference === 0 ? '—' : `${r.difference > 0 ? '+' : ''}${fmtRs(r.difference)}`) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-t border-border/50">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Total balance impact</span>
                  <span className={`text-sm font-black font-mono ${totalDifference < 0 ? 'text-emerald-600' : totalDifference > 0 ? 'text-rose-500' : ''}`}>
                    {rateValid ? `${totalDifference > 0 ? '+' : ''}${fmtRs(totalDifference)}` : '—'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Reason (required)
                </Label>
                <Textarea
                  placeholder="e.g. Customer refused the Sept 1 rate increase; management approved keeping the old rate"
                  className="min-h-[80px] text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {!reasonValid && reason.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>
                )}
              </div>
            </div>
            <DialogFooter className="gap-3 border-t pt-6 mt-2">
              <Button variant="ghost" onClick={handleClose} className="rounded-xl">Cancel</Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={!canReview}
                className="rounded-xl font-bold shadow-lg shadow-primary/20"
              >
                Review Changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="rounded-xl bg-accent/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Deliveries repriced</span>
                  <span className="text-sm font-black">{rows.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">New rate</span>
                  <span className="text-sm font-black font-mono">{fmtRs(newRateNum)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Balance impact</span>
                  <span className={`text-sm font-black font-mono ${totalDifference < 0 ? 'text-emerald-600' : totalDifference > 0 ? 'text-rose-500' : ''}`}>
                    {totalDifference > 0 ? '+' : ''}{fmtRs(totalDifference)}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-bold text-muted-foreground">Reason</span>
                <p className="text-sm font-medium">{reason}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                This cannot be auto-reversed — a mistaken repricing must be corrected with another repricing batch.
              </p>
            </div>
            <DialogFooter className="gap-3 border-t pt-6 mt-2">
              <Button variant="ghost" onClick={() => setStep('form')} className="rounded-xl" disabled={isPending}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-xl font-bold shadow-lg shadow-primary/20"
              >
                {isPending ? 'Saving...' : 'Confirm & Save'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
