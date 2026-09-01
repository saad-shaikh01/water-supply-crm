'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, Ban, Loader2 } from 'lucide-react';
import type { DeliveryItem, DeliveryVoidReason } from '@water-supply-crm/types';
import { useVoidDelivery } from '../../hooks/use-daily-sheets';

interface VoidDeliveryDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  item: DeliveryItem | null;
  isClosed: boolean;
}

const REASON_OPTIONS: { value: DeliveryVoidReason; label: string }[] = [
  { value: 'DUPLICATE', label: 'Duplicate entry' },
  { value: 'WRONG_SHEET', label: 'Wrong sheet' },
  { value: 'WRONG_DATE', label: 'Wrong date' },
  { value: 'NEVER_HAPPENED', label: 'Never happened' },
  { value: 'DATA_ENTRY_ERROR', label: 'Data entry error' },
  { value: 'OTHER', label: 'Other' },
];

export function VoidDeliveryDialog({ open, onClose, sheetId, item, isClosed }: VoidDeliveryDialogProps) {
  const { mutate: voidDelivery, isPending } = useVoidDelivery(sheetId);

  const [reason, setReason] = useState<DeliveryVoidReason | ''>('');
  const [note, setNote] = useState('');

  // Reset form state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
    }
  }, [open]);

  const noteRequired = reason === 'OTHER';
  const noteTooShort = note.trim().length > 0 && note.trim().length < 3;
  const isValid =
    !!reason &&
    (!noteRequired || note.trim().length >= 3) &&
    !noteTooShort;

  const handleSubmit = () => {
    if (!item || !isValid || !reason) return;
    voidDelivery(
      { itemId: item.id, voidReason: reason, voidNote: note.trim() || undefined },
      { onSuccess: onClose },
    );
  };

  const cash = item?.cashCollected ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Delivery
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
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-mono font-bold text-muted-foreground pt-1">
                <span>Filled dropped: {item.filledDropped}</span>
                <span>Empty received: {item.emptyReceived}</span>
                <span>Cash: ₨{cash.toLocaleString()}</span>
              </div>
            </div>

            {/* Warning banner */}
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="text-xs text-destructive font-medium leading-relaxed space-y-1.5">
                <p>This delivery will be removed from the record and the customer&apos;s balance will be adjusted.</p>
                {cash > 0 && (
                  <p>
                    ₨{cash.toLocaleString()} cash was collected on this delivery — voiding will reverse that too;
                    re-enter the cash when you add the correct delivery again.
                  </p>
                )}
                {isClosed && (
                  <p>The sheet is closed — this is a correction and will post on that day&apos;s date.</p>
                )}
              </div>
            </div>

            <div className="space-y-4 py-2">
              {/* Reason */}
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as DeliveryVoidReason | '')}
                  className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-destructive/30"
                >
                  <option value="" className="bg-background text-foreground dark:text-white">Select a reason…</option>
                  {REASON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Reason detail {noteRequired && <span className="text-destructive">*</span>}
                </Label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={noteRequired ? 'Explain why this delivery is being voided…' : 'Optional — add more context…'}
                  rows={3}
                  className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-destructive/30 resize-none placeholder:text-muted-foreground"
                />
                {(noteRequired || note.trim().length > 0) && note.trim().length < 3 && (
                  <p className="text-[11px] text-destructive">Reason detail must be at least 3 characters.</p>
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
            Void Delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
