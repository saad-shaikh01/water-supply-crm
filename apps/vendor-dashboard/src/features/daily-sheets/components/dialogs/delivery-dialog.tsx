'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Droplets, Loader2 } from 'lucide-react';
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

  const item = items.find((i) => i.id === open) ?? null;

  // Initialize form state when a new item is opened
  useEffect(() => {
    if (!item) return;
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory ?? 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason ?? '');
    setItemForm({
      filledDropped: item.filledDropped || 1,
      emptyReceived: item.emptyReceived || 0,
      cashCollected: item.cashCollected || 0,
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = () => {
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
    updateItem({ itemId: open, data: finalData }, { onSuccess: onClose });
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Discard</Button>
          <Button onClick={onSave} disabled={isPending} className="rounded-xl font-bold min-w-[120px]">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
