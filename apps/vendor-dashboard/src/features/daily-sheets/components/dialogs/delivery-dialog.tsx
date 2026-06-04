'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { CheckCircle2, Droplets, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem } from '@water-supply-crm/types';
import { useUpdateDeliveryItem } from '../../hooks/use-daily-sheets';

const FAILURE_CATEGORIES = [
  { value: 'CUSTOMER_NOT_HOME', label: 'Customer Not Home' },
  { value: 'CUSTOMER_NOT_ANSWERING', label: 'Customer Not Answering' },
  { value: 'CUSTOMER_SELF_PICKUP', label: 'Customer Self Pickup' },
  { value: 'VAN_BREAKDOWN', label: 'Van Breakdown' },
  { value: 'ACCESS_ISSUE', label: 'Area / Access Issue' },
  { value: 'CUSTOMER_REFUSED', label: 'Customer Refused' },
  { value: 'WEATHER', label: 'Weather / Road Issue' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface DeliveryDialogProps {
  /** The item id that is open, or null when closed */
  open: string | null;
  onClose: () => void;
  sheetId: string;
  items: DeliveryItem[];
}

export function DeliveryDialog({ open, onClose, sheetId, items }: DeliveryDialogProps) {
  const { mutate: updateItem, isPending } = useUpdateDeliveryItem(sheetId);

  const [deliveryMode, setDeliveryMode] = useState<'delivered' | 'unable'>('delivered');
  const [failureCategory, setFailureCategory] = useState('CUSTOMER_NOT_HOME');
  const [unableReason, setUnableReason] = useState('');
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [savedItem, setSavedItem] = useState<DeliveryItem | null>(null);

  const item = items.find((i) => i.id === open) ?? null;

  // Initialize form state when a new item is opened
  useEffect(() => {
    if (!item) return;
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory ?? 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason ?? '');
    setAwaitingConfirm(false);
    setSavedItem(null);
    setItemForm({
      filledDropped: item.filledDropped || 1,
      emptyReceived: item.emptyReceived || 0,
      cashCollected: item.cashCollected || 0,
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveClick = () => {
    if (!open) return;
    if (deliveryMode === 'delivered') {
      setAwaitingConfirm(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
    if (!open) return;
    const finalData: Record<string, unknown> = deliveryMode === 'delivered'
      ? {
          status: 'COMPLETED',
          filledDropped: itemForm.filledDropped ?? 1,
          emptyReceived: itemForm.emptyReceived ?? 0,
          cashCollected: itemForm.cashCollected ?? 0,
        }
      : {
          status: 'NOT_AVAILABLE',
          failureCategory,
          filledDropped: 0,
          emptyReceived: 0,
          cashCollected: 0,
          reason: unableReason || undefined,
        };
    updateItem(
      { itemId: open, data: finalData },
      {
        onSuccess: () => {
          // For successful deliveries show the "report damage?" step.
          // For unable-to-deliver, just close — no damage to report.
          if (deliveryMode === 'delivered' && item) {
            setSavedItem(item);
            setAwaitingConfirm(false);
          } else {
            onClose();
          }
        },
      },
    );
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            {item?.customer?.name ?? 'Record Delivery'}
          </DialogTitle>
        </DialogHeader>

        {savedItem ? (
          /* ── Post-save: offer damage report ── */
          <div className="py-6 space-y-5">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-bold text-emerald-700 dark:text-emerald-400">
                Delivery saved — {savedItem.customer?.name}
              </p>
            </div>

            <p className="text-sm text-center text-muted-foreground">
              Did any empties come back damaged?
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setSavedItem(null); onClose(); }}
                className="flex-1 py-3 rounded-2xl border border-border/50 bg-background text-sm font-bold text-muted-foreground hover:border-primary/30 transition-all"
              >
                No, Done
              </button>
              <Link
                href={`/dashboard/damage-report?dailySheetItemId=${savedItem.id}&customerId=${savedItem.customerId}&productId=${savedItem.productId}`}
                onClick={() => { setSavedItem(null); onClose(); }}
                className="flex-1 py-3 rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive text-sm font-bold flex items-center justify-center gap-2 hover:bg-destructive/20 transition-all"
              >
                <ShieldAlert className="h-4 w-4" />
                Report Damage
              </Link>
            </div>
          </div>
        ) : awaitingConfirm ? (
          <div className="py-6 space-y-5">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Confirm Delivery — {item?.customer?.name}</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Dropped</p>
                  <p className="text-lg font-black font-mono">{itemForm.filledDropped ?? 1}</p>
                </div>
                <div className="rounded-xl bg-background/70 border border-border/40 px-2 py-2">
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Empties</p>
                  <p className="text-lg font-black font-mono">{itemForm.emptyReceived ?? 0}</p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-2 py-2">
                  <p className="text-[9px] font-bold uppercase text-muted-foreground">Cash</p>
                  <p className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">₨{itemForm.cashCollected ?? 0}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">This will mark the delivery as <span className="font-bold text-emerald-600">COMPLETED</span> and update the customer&apos;s wallet and balance. This action cannot be undone without editing the record.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAwaitingConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-2xl text-sm font-bold border border-border/50 bg-background text-muted-foreground hover:border-primary/30 transition-all"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={doSave}
                disabled={isPending}
                className="flex-1 py-2.5 px-4 rounded-2xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm & Save
              </button>
            </div>
          </div>
        ) : (
        <div className="space-y-5 py-4">
          {/* Delivered / Unable toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMode('delivered')}
              className={cn(
                'flex-1 py-3 px-4 rounded-2xl text-sm font-bold border-2 transition-all',
                deliveryMode === 'delivered'
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400'
                  : 'bg-background border-border/50 text-muted-foreground hover:border-emerald-500/30',
              )}
            >
              Delivered
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMode('unable')}
              className={cn(
                'flex-1 py-3 px-4 rounded-2xl text-sm font-bold border-2 transition-all',
                deliveryMode === 'unable'
                  ? 'bg-destructive/10 border-destructive text-destructive'
                  : 'bg-background border-border/50 text-muted-foreground hover:border-destructive/30',
              )}
            >
              Unable to Deliver
            </button>
          </div>

          {deliveryMode === 'delivered' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest">Dropped</Label>
                  <Input
                    type="number"
                    min={0}
                    value={itemForm.filledDropped ?? 1}
                    onChange={(e) => setItemForm((p) => ({ ...p, filledDropped: Number(e.target.value) }))}
                    className="font-mono font-bold h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase tracking-widest">Empties Received</Label>
                  <Input
                    type="number"
                    min={0}
                    value={itemForm.emptyReceived ?? 0}
                    onChange={(e) => setItemForm((p) => ({ ...p, emptyReceived: Number(e.target.value) }))}
                    className="font-mono font-bold h-11"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Cash Collected (₨)</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.cashCollected ?? 0}
                  onChange={(e) => setItemForm((p) => ({ ...p, cashCollected: Number(e.target.value) }))}
                  className="h-12 text-lg font-black font-mono text-center bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Reason Category <span className="text-destructive">*</span>
                </Label>
                <Select value={failureCategory} onValueChange={setFailureCategory}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                    {FAILURE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value} className="rounded-lg">
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Notes (optional)
                </Label>
                <Input
                  placeholder="Additional details..."
                  value={unableReason}
                  onChange={(e) => setUnableReason(e.target.value)}
                  className="h-11"
                />
              </div>
              <p className="text-[11px] text-muted-foreground bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2">
                This reports an issue for ops planning. Drivers cannot reschedule or cancel from this screen.
              </p>
            </div>
          )}
        </div>
        )}

        {!awaitingConfirm && (
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Discard</Button>
          <Button onClick={handleSaveClick} disabled={isPending} className="rounded-xl font-bold min-w-[120px]">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Record
          </Button>
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
