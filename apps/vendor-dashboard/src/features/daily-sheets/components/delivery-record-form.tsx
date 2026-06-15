'use client';

import { useState, useEffect } from 'react';
import {
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton,
} from '@water-supply-crm/ui';
import { ClipboardEdit, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { DeliveryItem } from '@water-supply-crm/types';
import { useUpdateDeliveryItem, useCustomerFinancialSummary } from '../hooks/use-daily-sheets';
import { useReportDamage } from '../../driver/hooks/use-damage-cases';
import { DamagePhotoUpload } from '../../driver/components/damage-photo-upload';

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

function StatBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'paid' | 'balance';
}) {
  const valueClass =
    tone === 'paid'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'balance'
        ? value > 0
          ? 'text-destructive'
          : 'text-emerald-600 dark:text-emerald-400'
        : '';
  return (
    <div className="rounded-xl bg-background/70 border border-border/40 px-3 py-2">
      <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-black mt-0.5', valueClass)}>₨{value.toLocaleString()}</p>
    </div>
  );
}

interface DeliveryRecordFormProps {
  item: DeliveryItem;
  sheetId: string;
  onDone: () => void;
}

export function DeliveryRecordForm({ item, sheetId, onDone }: DeliveryRecordFormProps) {
  const { mutate: updateItem, isPending } = useUpdateDeliveryItem(sheetId);
  const { mutateAsync: reportDamage } = useReportDamage();

  const [deliveryMode, setDeliveryMode] = useState<'delivered' | 'unable'>('delivered');
  const [failureCategory, setFailureCategory] = useState('CUSTOMER_NOT_HOME');
  const [unableReason, setUnableReason] = useState('');
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});

  // Damage state
  const [showDamage, setShowDamage] = useState(false);
  const [damageForm, setDamageForm] = useState<{
    caseType: 'DAMAGE' | 'LOST';
    bottleCount: number;
    photoKeys: string[];
    description: string;
    lossReason: string;
  }>({ caseType: 'DAMAGE', bottleCount: 1, photoKeys: [], description: '', lossReason: 'CUSTOMER_NOT_RETURNED' });

  const effectivePrice = (() => {
    const custom = item.customer?.customPrices?.find((p) => p.productId === item.productId);
    return custom?.customPrice ?? item.product?.basePrice ?? 0;
  })();
  const isCustomPrice = !!item.customer?.customPrices?.find((p) => p.productId === item.productId);
  const isMonthly = item.customer?.paymentType === 'MONTHLY';
  const isFirstRecord = item.status === 'PENDING';

  // Initialize form state when the form mounts for a given item
  useEffect(() => {
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory ?? 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason ?? '');
    setShowDamage(false);
    setDamageForm({ caseType: 'DAMAGE', bottleCount: 1, photoKeys: [], description: '', lossReason: 'CUSTOMER_NOT_RETURNED' });
    const isFirst = item.status === 'PENDING';
    // Drop & empties start at 0 by default — driver enters the real counts manually.
    // Cash is never auto-calculated — the driver types whatever they actually collected.
    const suggestedFilled = isFirst ? 0 : item.filledDropped;
    const suggestedCash = isFirst ? 0 : item.cashCollected;

    setItemForm({
      filledDropped: suggestedFilled,
      emptyReceived: item.emptyReceived > 0 ? item.emptyReceived : 0,
      cashCollected: suggestedCash,
    });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Amount owed for this delivery — auto-calculated from drop count and the customer's rate.
  const amountDue = Math.round((itemForm.filledDropped ?? 0) * effectivePrice);

  // Monthly financial snapshot (anchored to the sheet's month) — fetched lazily
  // since this form only mounts when the card is expanded.
  const { data: finSummary, isLoading: finLoading } = useCustomerFinancialSummary(
    item.customerId,
    sheetId,
    true,
  );

  // Live preview: project how this delivery changes the customer's figures as the
  // driver types. A delivery adds a charge (drop × rate) and the cash is a payment.
  // For a re-record we first back out the item's already-saved contribution so the
  // numbers don't double-count.
  const savedCharge = isFirstRecord ? 0 : item.filledDropped * (item.pricePerBottle ?? effectivePrice);
  const savedCash = isFirstRecord ? 0 : item.cashCollected;
  const draftCharge = deliveryMode === 'delivered' ? amountDue : 0;
  const draftCash = deliveryMode === 'delivered' ? (itemForm.cashCollected ?? 0) : 0;
  const livePaidThisMonth = (finSummary?.currentMonthPaid ?? 0) - savedCash + draftCash;
  const liveCurrentOutstanding =
    (finSummary?.currentOutstanding ?? 0) - (savedCharge - savedCash) + (draftCharge - draftCash);

  const doSave = () => {
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
      { itemId: item.id, data: finalData },
      {
        onSuccess: () => {
          // Submit damage case fire-and-forget if driver reported damage
          if (showDamage) {
            reportDamage({
              customerId: item.customerId,
              productId: item.productId,
              dailySheetItemId: item.id,
              caseType: damageForm.caseType,
              severity: damageForm.caseType === 'DAMAGE' ? 'MODERATE' : undefined,
              bottleCount: damageForm.bottleCount,
              photoPaths: damageForm.caseType === 'DAMAGE' ? damageForm.photoKeys : [],
              description: damageForm.description || undefined,
              lossReason: damageForm.caseType === 'LOST' ? damageForm.lossReason : undefined,
            }).catch(() => {
              // Silent fail — driver is already on next stop.
              // The damage case can be reported manually from the sidebar.
            });
          }
          onDone();
        },
      },
    );
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-background/70 p-4 space-y-5">
      <p className="text-sm font-black flex items-center gap-2">
        <ClipboardEdit className="h-4 w-4 text-primary" />
        {isFirstRecord ? 'Record Delivery' : 'Edit Delivery'}
      </p>

      {!isFirstRecord && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-sm">
          <span className="text-amber-500 mt-0.5">⚠</span>
          <div>
            <p className="font-bold text-amber-700 dark:text-amber-400">Already Recorded</p>
            <p className="text-xs text-muted-foreground">This delivery was recorded as <span className="font-bold">{item.status}</span>. Saving will override the existing record.</p>
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
            {/* LEFT COLUMN — entry fields stacked vertically */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Dropped</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.filledDropped ?? 0}
                  onChange={(e) => setItemForm((p) => ({ ...p, filledDropped: Number(e.target.value) }))}
                  className="font-mono font-bold h-11"
                />
                {isFirstRecord && item.lastFilledDropped != null && (
                  <p className="text-[11px] text-muted-foreground">
                    Last delivery: <span className="font-bold">{item.lastFilledDropped} btl</span>
                  </p>
                )}
                {/* Expected (wallet) hint hidden for now — not needed currently.
                {(() => {
                  const wb = item.customer?.wallets?.find((w) => w.productId === item.productId)?.balance ?? 0;
                  return wb > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Expected: <span className="font-bold">{wb} btl</span> (wallet)
                    </p>
                  ) : null;
                })()}
                */}
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

              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Balance (₨)</Label>
                <Input
                  type="number"
                  value={amountDue}
                  disabled
                  readOnly
                  className="font-mono font-bold h-11 bg-muted/50 text-muted-foreground cursor-not-allowed"
                />
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                  Auto · Drop × {effectivePrice > 0 ? `₨${effectivePrice.toLocaleString()}` : 'Rate'}
                  {isCustomPrice && (
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-[10px]">
                      Custom
                    </span>
                  )}
                </p>
              </div>

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
                    'h-11 font-mono font-bold',
                    isMonthly
                      ? 'bg-muted/50 text-muted-foreground cursor-not-allowed'
                      : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                  )}
                />
                {isMonthly && (
                  <p className="text-[11px] text-muted-foreground">Monthly account — cash is billed, not collected on delivery.</p>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN — customer monthly financial snapshot */}
            <div className="space-y-2">
              {finLoading ? (
                [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[52px] w-full rounded-xl" />)
              ) : (
                <>
                  <StatBox label="Prev Month Bill" value={finSummary?.prevMonthAmount ?? 0} />
                  <StatBox label="Paid This Month" value={livePaidThisMonth} tone="paid" />
                  <StatBox label="Prev Month Outstanding" value={finSummary?.prevMonthOutstanding ?? 0} tone="balance" />
                  <StatBox label="Current Outstanding" value={liveCurrentOutstanding} tone="balance" />
                </>
              )}
            </div>
          </div>

          {/* Bottle problem section */}
          <div className="rounded-2xl border border-border/40 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (showDamage) {
                  setShowDamage(false);
                  setDamageForm({ caseType: 'DAMAGE', bottleCount: 1, photoKeys: [], description: '', lossReason: 'CUSTOMER_NOT_RETURNED' });
                } else {
                  setShowDamage(true);
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-card/60 transition-colors"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                Bottle Problem?
              </span>
              <span className={cn('text-xs font-bold transition-colors', showDamage ? 'text-destructive' : 'text-muted-foreground')}>
                {showDamage
                  ? (damageForm.caseType === 'DAMAGE' ? 'Reporting damage' : 'Reporting lost')
                  : 'No problem'}
              </span>
            </button>

            {showDamage && (
              <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4 bg-destructive/5">
                {/* Type selection */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDamageForm((p) => ({ ...p, caseType: 'DAMAGE' }))}
                    className={cn(
                      'flex flex-col items-center gap-1 py-3 px-2 rounded-xl text-xs font-bold border-2 transition-all',
                      damageForm.caseType === 'DAMAGE'
                        ? 'bg-amber-500/15 border-amber-500 text-amber-700 dark:text-amber-400'
                        : 'bg-background border-border text-muted-foreground',
                    )}
                  >
                    <span className="text-base">🔧</span>
                    <span>Empty Damaged</span>
                    <span className="text-[9px] font-normal opacity-70">Customer returned it broken</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDamageForm((p) => ({ ...p, caseType: 'LOST' }))}
                    className={cn(
                      'flex flex-col items-center gap-1 py-3 px-2 rounded-xl text-xs font-bold border-2 transition-all',
                      damageForm.caseType === 'LOST'
                        ? 'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-400'
                        : 'bg-background border-border text-muted-foreground',
                    )}
                  >
                    <span className="text-base">❓</span>
                    <span>Bottle Not Given</span>
                    <span className="text-[9px] font-normal opacity-70">Customer didn&apos;t return it</span>
                  </button>
                </div>

                {/* Bottle count */}
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    How many bottles?
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={damageForm.bottleCount}
                    onChange={(e) => setDamageForm((p) => ({ ...p, bottleCount: Math.max(1, Number(e.target.value)) }))}
                    className="h-11 font-mono font-bold"
                  />
                </div>

                {/* DAMAGE: photo upload + notes */}
                {damageForm.caseType === 'DAMAGE' && (
                  <>
                    <DamagePhotoUpload
                      onPhotosChange={(keys) => setDamageForm((p) => ({ ...p, photoKeys: keys }))}
                      maxPhotos={3}
                    />
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
                  </>
                )}

                {/* LOST: reason selection */}
                {damageForm.caseType === 'LOST' && (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Why wasn&apos;t it returned?
                    </Label>
                    <div className="space-y-2">
                      {[
                        { value: 'CUSTOMER_NOT_RETURNED', label: "Customer didn't have it" },
                        { value: 'CUSTOMER_SAID_LOST', label: 'Customer said it got lost' },
                        { value: 'WRONG_ADDRESS', label: 'Left at wrong address' },
                        { value: 'OTHER', label: 'Other reason' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDamageForm((p) => ({ ...p, lossReason: opt.value }))}
                          className={cn(
                            'w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
                            damageForm.lossReason === opt.value
                              ? 'bg-rose-500/10 border-rose-500/60 text-rose-700 dark:text-rose-400'
                              : 'bg-background border-border text-muted-foreground',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
                  {damageForm.caseType === 'DAMAGE'
                    ? 'Damage report will be submitted automatically when you save this delivery.'
                    : 'Lost bottle report will be submitted automatically when you save this delivery.'}
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

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" onClick={onDone} disabled={isPending} className="rounded-xl font-bold">
          Discard
        </Button>
        <Button onClick={doSave} disabled={isPending} className="flex-1 rounded-xl font-bold">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save Record
        </Button>
      </div>
    </div>
  );
}
