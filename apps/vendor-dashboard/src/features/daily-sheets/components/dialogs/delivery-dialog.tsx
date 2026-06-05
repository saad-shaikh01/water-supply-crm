'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { Droplets, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem } from '@water-supply-crm/types';
import { useUpdateDeliveryItem } from '../../hooks/use-daily-sheets';
import { useReportDamage } from '../../../driver/hooks/use-damage-cases';
import { DamagePhotoUpload } from '../../../driver/components/damage-photo-upload';

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
  const { mutateAsync: reportDamage } = useReportDamage();

  const [deliveryMode, setDeliveryMode] = useState<'delivered' | 'unable'>('delivered');
  const [failureCategory, setFailureCategory] = useState('CUSTOMER_NOT_HOME');
  const [unableReason, setUnableReason] = useState('');
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  // Damage state
  const [showDamage, setShowDamage] = useState(false);
  const [damageForm, setDamageForm] = useState<{
    severity: 'MINOR' | 'MODERATE' | 'SEVERE';
    bottleCount: number;
    photoKeys: string[];
    description: string;
  }>({ severity: 'MODERATE', bottleCount: 1, photoKeys: [], description: '' });

  const item = items.find((i) => i.id === open) ?? null;

  const effectivePrice = (() => {
    if (!item) return 0;
    const custom = item.customer?.customPrices?.find(p => p.productId === item.productId);
    return custom?.customPrice ?? item.product?.basePrice ?? 0;
  })();
  const isCustomPrice = !!(item?.customer?.customPrices?.find(p => p.productId === item?.productId));
  const isMonthly = item?.customer?.paymentType === 'MONTHLY';
  const isFirstRecord = item?.status === 'PENDING';

  // Initialize form state when a new item is opened
  useEffect(() => {
    if (!item) return;
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory ?? 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason ?? '');
    setAwaitingConfirm(false);
    setShowDamage(false);
    setDamageForm({ severity: 'MODERATE', bottleCount: 1, photoKeys: [], description: '' });
    const isFirst = item.status === 'PENDING';
    const custom = item.customer?.customPrices?.find(p => p.productId === item.productId);
    const price = custom?.customPrice ?? item.product?.basePrice ?? 0;
    const isMonthlyInit = item.customer?.paymentType === 'MONTHLY';
    const suggestedFilled = isFirst ? (item.lastFilledDropped ?? 1) : item.filledDropped;
    const suggestedCash = isMonthlyInit
      ? 0
      : isFirst
        ? Math.round(suggestedFilled * price)
        : item.cashCollected;

    setItemForm({
      filledDropped: suggestedFilled,
      emptyReceived: item.emptyReceived > 0 ? item.emptyReceived : 0,
      cashCollected: suggestedCash,
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculate cash when filledDropped changes (CASH customers, first-time record only)
  useEffect(() => {
    if (!item || deliveryMode !== 'delivered') return;
    if (item.customer?.paymentType === 'MONTHLY') {
      setItemForm((p) => ({ ...p, cashCollected: 0 }));
      return;
    }
    if (item.status === 'PENDING') {
      const custom2 = item.customer?.customPrices?.find((p) => p.productId === item.productId);
      const price2 = custom2?.customPrice ?? item.product?.basePrice ?? 0;
      setItemForm((p) => ({ ...p, cashCollected: Math.round((p.filledDropped ?? 0) * price2) }));
    }
  }, [itemForm.filledDropped, deliveryMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveClick = () => {
    if (!open) return;
    setAwaitingConfirm(true);
  };

  const doSave = () => {
    if (!open) return;
    const finalData: Record<string, unknown> = deliveryMode === 'delivered'
      ? {
          status: 'COMPLETED',
          filledDropped: itemForm.filledDropped ?? 1,
          emptyReceived: itemForm.emptyReceived ?? 0,
          cashCollected: itemForm.cashCollected ?? 0,
          forceResubmit: !isFirstRecord,
        }
      : {
          status: 'NOT_AVAILABLE',
          failureCategory,
          filledDropped: 0,
          emptyReceived: 0,
          cashCollected: 0,
          reason: unableReason || undefined,
          forceResubmit: !isFirstRecord,
        };
    updateItem(
      { itemId: open, data: finalData },
      {
        onSuccess: () => {
          // Submit damage case fire-and-forget if driver reported damage
          if (showDamage && item) {
            reportDamage({
              customerId: item.customerId,
              productId: item.productId,
              dailySheetItemId: item.id,
              severity: damageForm.severity,
              bottleCount: damageForm.bottleCount,
              photoPaths: damageForm.photoKeys,
              description: damageForm.description || undefined,
            }).catch(() => {
              // Silent fail — driver is already on next stop.
              // The damage case can be reported manually from the sidebar.
            });
          }
          onClose();
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

        {awaitingConfirm ? (
          <div className="py-6 space-y-5">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Confirm Delivery — {item?.customer?.name}</p>
              {deliveryMode === 'delivered' && (
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
              )}
              {deliveryMode === 'unable' && (
                <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Reason: <span className="font-bold">{failureCategory.replace(/_/g, ' ')}</span></p>
                </div>
              )}
              {deliveryMode === 'delivered'
                ? <p className="text-[11px] text-muted-foreground">This will mark the delivery as <span className="font-bold text-emerald-600">COMPLETED</span> and update the customer&apos;s wallet and balance.</p>
                : <p className="text-[11px] text-muted-foreground">This will mark the delivery as <span className="font-bold text-destructive">NOT AVAILABLE</span> and log a delivery issue. The customer will be rescheduled.</p>
              }
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
          {!isFirstRecord && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-sm">
              <span className="text-amber-500 mt-0.5">⚠</span>
              <div>
                <p className="font-bold text-amber-700 dark:text-amber-400">Already Recorded</p>
                <p className="text-xs text-muted-foreground">This delivery was recorded as <span className="font-bold">{item?.status}</span>. Saving will override the existing record.</p>
              </div>
            </div>
          )}
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
                {isFirstRecord && item?.lastFilledDropped != null && (
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    Last delivery: <span className="font-bold">{item.lastFilledDropped} btl</span>
                  </p>
                )}
                {(() => {
                  const wb = item?.customer?.wallets?.find((w) => w.productId === item.productId)?.balance ?? 0;
                  return wb > 0 ? (
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Expected: <span className="font-bold">{wb} btl</span> (wallet)
                    </p>
                  ) : null;
                })()}
              </div>
              {effectivePrice > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Rate:</span>
                  <span className="font-bold font-mono">₨{effectivePrice.toLocaleString()}/bottle</span>
                  {isCustomPrice && (
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-[10px]">
                      Custom
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Cash Collected (₨)</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.cashCollected ?? 0}
                  onChange={(e) => {
                    if (!isMonthly) setItemForm((p) => ({ ...p, cashCollected: Number(e.target.value) }));
                  }}
                  disabled={isMonthly}
                  className={cn(
                    'h-12 text-lg font-black font-mono text-center',
                    isMonthly
                      ? 'bg-muted/50 text-muted-foreground cursor-not-allowed'
                      : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                  )}
                />
                {isMonthly && (
                  <p className="text-[11px] text-muted-foreground">Monthly account — cash is billed, not collected on delivery.</p>
                )}
              </div>

              {/* Damaged empties section */}
              <div className="rounded-2xl border border-border/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDamage((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-card/60 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    Any empties damaged?
                  </span>
                  <span className={cn('text-xs font-bold transition-colors', showDamage ? 'text-destructive' : 'text-muted-foreground')}>
                    {showDamage ? 'Yes — filling report' : 'No damage'}
                  </span>
                </button>

                {showDamage && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4 bg-destructive/5">
                    {/* Severity */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Severity</Label>
                      <div className="flex gap-2">
                        {(['MINOR', 'MODERATE', 'SEVERE'] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setDamageForm((p) => ({ ...p, severity: s }))}
                            className={cn(
                              'flex-1 py-2 rounded-xl text-xs font-bold border transition-all',
                              damageForm.severity === s
                                ? s === 'MINOR'
                                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                                  : s === 'MODERATE'
                                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                    : 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                                : 'bg-background border-border text-muted-foreground',
                            )}
                          >
                            {s.charAt(0) + s.slice(1).toLowerCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Count */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Damaged Count
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        value={damageForm.bottleCount}
                        onChange={(e) => setDamageForm((p) => ({ ...p, bottleCount: Math.max(1, Number(e.target.value)) }))}
                        className="h-11 font-mono font-bold"
                      />
                    </div>

                    {/* Photo upload */}
                    <DamagePhotoUpload
                      onPhotosChange={(keys) => setDamageForm((p) => ({ ...p, photoKeys: keys }))}
                      maxPhotos={3}
                    />

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Notes (optional)
                      </Label>
                      <Input
                        placeholder="Describe the damage..."
                        value={damageForm.description}
                        onChange={(e) => setDamageForm((p) => ({ ...p, description: e.target.value }))}
                        className="h-11"
                      />
                    </div>

                    <p className="text-[11px] text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
                      Damage report will be submitted automatically when you save this delivery.
                    </p>
                  </div>
                )}
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
