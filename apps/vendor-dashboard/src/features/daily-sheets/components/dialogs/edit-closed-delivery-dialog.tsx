'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Pencil, Loader2 } from 'lucide-react';
import type { DeliveryItem } from '@water-supply-crm/types';
import { useCorrectClosedDelivery } from '../../hooks/use-daily-sheets';

interface EditClosedDeliveryDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  item: DeliveryItem | null;
}

export function EditClosedDeliveryDialog({ open, onClose, sheetId, item }: EditClosedDeliveryDialogProps) {
  const { mutate: correctDelivery, isPending } = useCorrectClosedDelivery(sheetId);

  const [filledDropped, setFilledDropped] = useState('');
  const [emptyReceived, setEmptyReceived] = useState('');
  const [filledReceived, setFilledReceived] = useState('');
  const [cashCollected, setCashCollected] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [note, setNote] = useState('');

  // Reset form state (pre-filled from the item) whenever the dialog opens.
  useEffect(() => {
    if (open && item) {
      setFilledDropped(String(item.filledDropped ?? 0));
      setEmptyReceived(String(item.emptyReceived ?? 0));
      setFilledReceived(String(item.filledReceived ?? 0));
      setCashCollected(String(item.cashCollected ?? 0));
      setPriceOverride('');
      setNote('');
    }
  }, [open, item]);

  const noteValid = note.trim().length >= 3;
  const numbersValid = [filledDropped, emptyReceived, filledReceived, cashCollected].every(
    (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0,
  );
  const priceValid = priceOverride === '' || (Number.isFinite(Number(priceOverride)) && Number(priceOverride) >= 0);
  const isValid = noteValid && numbersValid && priceValid;

  const handleSubmit = () => {
    if (!item || !isValid) return;
    correctDelivery(
      {
        itemId: item.id,
        filledDropped: Number(filledDropped),
        emptyReceived: Number(emptyReceived),
        filledReceived: Number(filledReceived),
        cashCollected: Number(cashCollected),
        priceOverride: priceOverride === '' ? undefined : Number(priceOverride),
        correctionNote: note.trim(),
      },
      { onSuccess: onClose },
    );
  };

  const numberField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
  ) => (
    <div className="space-y-1.5">
      <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Correct Closed-Sheet Delivery
          </DialogTitle>
        </DialogHeader>

        {item && (
          <>
            {/* Which delivery */}
            <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
              <p className="text-sm font-bold">
                {item.customer?.name}
                {item.customer?.customerCode && (
                  <span className="text-[11px] font-mono text-muted-foreground"> ({item.customer.customerCode})</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.product?.name ?? '—'} · Status: <span className="font-bold">{item.status}</span>
              </p>
            </div>

            {/* Warning banner */}
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                This sheet is closed. Correcting these figures adjusts the customer&apos;s balance and bottle
                wallet, posted to the original delivery date. The close-time cash figure and any discrepancy
                cases stay as they were.
              </p>
            </div>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                {numberField('Filled dropped', filledDropped, setFilledDropped)}
                {numberField('Empty received', emptyReceived, setEmptyReceived)}
                {numberField('Filled received', filledReceived, setFilledReceived)}
                {numberField('Cash collected', cashCollected, setCashCollected)}
              </div>

              {/* Price override */}
              <div className="space-y-1.5">
                <Label className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground">
                  Price override
                </Label>
                <input
                  type="number"
                  min={0}
                  value={priceOverride}
                  onChange={(e) => setPriceOverride(e.target.value)}
                  placeholder={`Keep current — ₨${(item.pricePerBottle ?? 0).toLocaleString()}`}
                  className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
                />
                <p className="text-[11px] text-muted-foreground">Leave blank to keep the current per-bottle price.</p>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Reason for correction <span className="text-destructive">*</span>
                </Label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Explain what was wrong and what it should be…"
                  rows={3}
                  className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none placeholder:text-muted-foreground"
                />
                {!noteValid && (
                  <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>
                )}
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || !isValid}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
