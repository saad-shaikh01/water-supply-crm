'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton,
} from '@water-supply-crm/ui';
import { ClipboardEdit, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type {
  DeliveryItem, CollectionPolicy, CollectionPolicyResult, CashCollectionPolicy, CashCollectionPolicyResult, PaymentTypeValue,
} from '@water-supply-crm/types';
import { useUpdateDeliveryItem, useCustomerFinancialSummary } from '../hooks/use-daily-sheets';
import { useReportDamage } from '../../driver/hooks/use-damage-cases';
import { DamagePhotoUpload } from '../../driver/components/damage-photo-upload';
import { DeliveryFailurePhotoCapture } from './delivery-failure-photo-capture';

const FAILURE_CATEGORIES = [
  { value: 'CUSTOMER_NOT_HOME', label: 'Customer Not Home' },
  { value: 'CUSTOMER_NOT_ANSWERING', label: 'Customer Not Answering' },
  { value: 'CUSTOMER_SELF_PICKUP', label: 'Customer Self Pickup' },
  { value: 'VAN_BREAKDOWN', label: 'Van Breakdown' },
  { value: 'ACCESS_ISSUE', label: 'Area / Access Issue' },
  { value: 'CUSTOMER_REFUSED', label: 'Customer Refused' },
  { value: 'WEATHER', label: 'Weather / Road Issue' },
  { value: 'PAYMENT_NOT_MADE', label: 'Customer Unable to Pay' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface DamageFormState {
  caseType: 'DAMAGE' | 'LOST';
  bottleCount: number;
  photoKeys: string[];
  description: string;
  lossReason: string;
}

const DEFAULT_DAMAGE_FORM: DamageFormState = {
  caseType: 'DAMAGE',
  bottleCount: 1,
  photoKeys: [],
  description: '',
  lossReason: 'CUSTOMER_NOT_RETURNED',
};

// Mobile browsers (esp. lower-RAM Android/iOS) frequently kill and reload the
// tab when it's backgrounded — launching the camera, phone dialer, or WhatsApp
// all trigger this. A full reload wipes React state, so we mirror in-progress
// form state to sessionStorage and restore it on the next mount for the same item.
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface DeliveryDraft {
  deliveryMode: 'delivered' | 'unable';
  failureCategory: string;
  unableReason: string;
  photoKey: string | null;
  itemForm: Partial<DeliveryItem>;
  showDamage: boolean;
  damageForm: DamageFormState;
  savedAt: number;
}

const draftKey = (itemId: string) => `daily-sheet-draft:${itemId}`;

function readDraft(itemId: string): DeliveryDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(itemId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as DeliveryDraft;
    if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(draftKey(itemId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(itemId: string, draft: Omit<DeliveryDraft, 'savedAt'>) {
  try {
    sessionStorage.setItem(draftKey(itemId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // sessionStorage unavailable/full — draft recovery is best-effort only
  }
}

function clearDraft(itemId: string) {
  try {
    sessionStorage.removeItem(draftKey(itemId));
  } catch {
    // ignore
  }
}

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

/**
 * Frontend mirror of the backend's evaluateCollectionPolicy
 * (apps/api-backend/src/app/common/helpers/collection-policy.util.ts). The
 * frontend cannot import backend code, so this re-implements the same ~10
 * lines of arithmetic against the shared CollectionPolicy/CollectionPolicyResult
 * types (docs/features/monthly-customer-collection-policy.md §4, §7.2). Pure,
 * no I/O — check order matches the backend exactly, including the
 * BELOW_THRESHOLD-before-ZERO_CASH precedence.
 */
function evaluateCollectionPolicy(
  policy: CollectionPolicy,
  input: {
    paymentType: PaymentTypeValue | undefined;
    isBillingExempt: boolean;
    remainingPreviousOutstanding: number;
    cashCollected: number;
  },
): CollectionPolicyResult {
  const remainingPreviousOutstanding = Math.max(input.remainingPreviousOutstanding, 0);
  const collectedAmount = input.cashCollected;
  const base = { collectedAmount, remainingPreviousOutstanding };

  if (!policy.enabled) {
    return { applies: false, satisfied: true, reason: 'DISABLED', requiredAmount: 0, ...base };
  }
  if (input.paymentType !== 'MONTHLY') {
    return { applies: false, satisfied: true, reason: 'NOT_MONTHLY', requiredAmount: 0, ...base };
  }
  if (input.isBillingExempt) {
    return { applies: false, satisfied: true, reason: 'BILLING_EXEMPT', requiredAmount: 0, ...base };
  }
  if (remainingPreviousOutstanding < policy.minOutstandingThreshold) {
    return { applies: false, satisfied: true, reason: 'BELOW_THRESHOLD', requiredAmount: 0, ...base };
  }
  if (collectedAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'ZERO_CASH', requiredAmount: 0, ...base };
  }

  const requiredAmount = Math.max(
    0,
    Math.round((remainingPreviousOutstanding * policy.minCollectionPercentage) / 100) - policy.allowedShortfall,
  );
  const satisfied = collectedAmount >= requiredAmount;

  return {
    applies: true,
    satisfied,
    reason: satisfied ? undefined : 'BELOW_MINIMUM',
    requiredAmount,
    ...base,
  };
}

/**
 * Frontend mirror of the backend's evaluateCashCollectionPolicy
 * (apps/api-backend/src/app/common/helpers/collection-policy.util.ts). Pure,
 * no I/O — same check order as the backend exactly (DISABLED -> NOT_CASH ->
 * BILLING_EXEMPT -> NO_CHARGE -> WITHIN_FLOOR -> compute), including the
 * DOWN-to-nearest-₨10 rounding (docs/features/cash-customer-collection-policy.md
 * §4.8, §14). Fed the three independent inputs (currentBalance, chargeAmount,
 * cashCollected) — never a post-payment preview — so the parity bug the
 * monthly evaluator mirror had (Phase 3/4) is unrepresentable here (§10).
 */
function evaluateCashCollectionPolicy(
  policy: CashCollectionPolicy,
  input: {
    paymentType: PaymentTypeValue | undefined;
    isBillingExempt: boolean;
    currentBalance: number;
    chargeAmount: number;
    cashCollected: number;
  },
): CashCollectionPolicyResult {
  const currentBalance = input.currentBalance;
  const chargeAmount = input.chargeAmount;
  const exposure = currentBalance + chargeAmount;
  const collectedAmount = input.cashCollected;
  const base = {
    collectedAmount,
    currentBalance,
    chargeAmount,
    exposure,
    allowedCreditDeliveries: policy.allowedCreditDeliveries,
  };

  if (!policy.enabled) {
    return { applies: false, satisfied: true, reason: 'DISABLED', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (input.paymentType !== 'CASH') {
    return { applies: false, satisfied: true, reason: 'NOT_CASH', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (input.isBillingExempt) {
    return { applies: false, satisfied: true, reason: 'BILLING_EXEMPT', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (chargeAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'NO_CHARGE', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }
  if (exposure <= policy.minExposureFloor) {
    return { applies: false, satisfied: true, reason: 'WITHIN_FLOOR', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }

  const proportional = exposure / (policy.allowedCreditDeliveries + 1);
  const ceilingTerm = policy.maxOutstandingCeiling != null ? exposure - policy.maxOutstandingCeiling : 0;
  const raw = Math.min(Math.max(Math.max(proportional, ceilingTerm), 0), exposure);
  const requiredAmount = Math.floor(raw / 10) * 10;

  if (requiredAmount <= 0) {
    return { applies: false, satisfied: true, reason: 'WITHIN_FLOOR', requiredAmount: 0, projectedBalance: exposure - collectedAmount, ...base };
  }

  const satisfied = collectedAmount >= requiredAmount;

  return {
    applies: true,
    satisfied,
    reason: satisfied ? undefined : 'BELOW_MINIMUM',
    requiredAmount,
    projectedBalance: exposure - collectedAmount,
    ...base,
  };
}

interface DeliveryRecordFormProps {
  item: DeliveryItem;
  sheetId: string;
  /** Vendor's Collection Policy config, attached to the sheet payload (Phase 1 §6.4). */
  collectionPolicy?: CollectionPolicy;
  /** Vendor's Cash Collection Policy config, attached to the sheet payload (§9.3). */
  cashCollectionPolicy?: CashCollectionPolicy;
  /** Whether this customer has other unrecorded items on this sheet (§8.3 multi-item guidance). */
  hasOtherUnrecordedItemsForCustomer?: boolean;
  onDone: () => void;
  readOnly?: boolean;
}

export function DeliveryRecordForm({
  item, sheetId, collectionPolicy, cashCollectionPolicy, hasOtherUnrecordedItemsForCustomer = false, onDone, readOnly = false,
}: DeliveryRecordFormProps) {
  const { mutate: updateItem, isPending } = useUpdateDeliveryItem(sheetId);
  const { mutateAsync: reportDamage } = useReportDamage();

  const [deliveryMode, setDeliveryMode] = useState<'delivered' | 'unable'>('delivered');
  const [failureCategory, setFailureCategory] = useState('CUSTOMER_NOT_HOME');
  const [unableReason, setUnableReason] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});

  // Damage state
  const [showDamage, setShowDamage] = useState(false);
  const [damageForm, setDamageForm] = useState<DamageFormState>(DEFAULT_DAMAGE_FORM);

  // Collection Policy: the backend's 422 backstop result (stale-client / direct-API-call
  // cases where the local mirror below didn't already catch the violation). Cleared as
  // soon as the driver edits cash or mode again — never persisted.
  const [serverViolation, setServerViolation] = useState<CollectionPolicyResult | null>(null);
  // Cash Collection Policy's own 422 backstop result — separate state since the two
  // result shapes differ; only one of the two policies ever applies to a given
  // customer (mutually exclusive by paymentType), so only one is ever non-null.
  const [cashServerViolation, setCashServerViolation] = useState<CashCollectionPolicyResult | null>(null);

  const effectivePrice = (() => {
    const custom = item.customer?.customPrices?.find((p) => p.productId === item.productId);
    return custom?.customPrice ?? item.product?.basePrice ?? 0;
  })();
  const isCustomPrice = !!item.customer?.customPrices?.find((p) => p.productId === item.productId);
  const isFirstRecord = item.status === 'PENDING';

  // Initialize form state when the form mounts for a given item — restoring an
  // unsaved draft (if the tab was reloaded mid-entry) takes priority over defaults.
  useEffect(() => {
    const draft = !readOnly ? readDraft(item.id) : null;
    if (draft) {
      setDeliveryMode(draft.deliveryMode);
      setFailureCategory(draft.failureCategory);
      setUnableReason(draft.unableReason);
      setPhotoKey(draft.photoKey);
      setItemForm(draft.itemForm);
      setShowDamage(draft.showDamage);
      setDamageForm(draft.damageForm);
      return;
    }
    const isUnable = item.status === 'RESCHEDULED' || item.status === 'CANCELLED' || item.status === 'NOT_AVAILABLE';
    setDeliveryMode(item.status === 'PENDING' ? 'delivered' : isUnable ? 'unable' : 'delivered');
    setFailureCategory(item.failureCategory ?? 'CUSTOMER_NOT_HOME');
    setUnableReason(item.reason ?? '');
    setPhotoKey(item.photoKey ?? null);
    setShowDamage(false);
    setDamageForm(DEFAULT_DAMAGE_FORM);
    const isFirst = item.status === 'PENDING';
    // Drop & empties start empty for new records — driver enters the real counts manually.
    // For re-records, pre-fill with previously saved values.
    const suggestedFilled = isFirst ? undefined : item.filledDropped;
    const suggestedCash = isFirst ? undefined : item.cashCollected;

    setItemForm({
      filledDropped: suggestedFilled,
      emptyReceived: item.emptyReceived > 0 ? item.emptyReceived : undefined,
      cashCollected: suggestedCash,
    });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror in-progress state to sessionStorage so a browser-triggered reload
  // (camera/dialer/WhatsApp backgrounding the tab) doesn't lose driver progress.
  const draftWriteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (readOnly) return;
    if (draftWriteTimeout.current) clearTimeout(draftWriteTimeout.current);
    draftWriteTimeout.current = setTimeout(() => {
      writeDraft(item.id, { deliveryMode, failureCategory, unableReason, photoKey, itemForm, showDamage, damageForm });
    }, 400);
    return () => {
      if (draftWriteTimeout.current) clearTimeout(draftWriteTimeout.current);
    };
  }, [item.id, readOnly, deliveryMode, failureCategory, unableReason, photoKey, itemForm, showDamage, damageForm]);

  // Clear a stale server-side policy violation as soon as the driver changes the cash
  // amount or delivery mode — the next save attempt should be judged fresh.
  useEffect(() => {
    setServerViolation(null);
    setCashServerViolation(null);
  }, [itemForm.cashCollected, deliveryMode]);

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
  // Remaining balance carried over from before this month, reduced by payments made
  // this month (incl. the cash being entered now), floored at 0.
  // Used ONLY for the Prev Month Outstanding StatBox / live financial preview below —
  // NOT for Collection Policy validation (see remainingForPolicyCheck).
  const livePrevMonthRemaining = Math.max((finSummary?.prevMonthOutstanding ?? 0) - livePaidThisMonth, 0);

  // Collection Policy validation base — deliberately NOT livePrevMonthRemaining.
  // livePrevMonthRemaining is a post-payment preview (it subtracts draftCash, the
  // amount currently being typed), which the backend gate never does: submitDelivery
  // computes remainingPreviousOutstanding purely from transaction history, backing out
  // only the item's own previously-saved cash on a resubmit (savedCash) — never the new
  // candidate amount. Mirroring livePrevMonthRemaining here made the effective required
  // amount shrink as the driver typed more cash, producing false-negative validation
  // (docs/features/monthly-customer-collection-policy.md §7.2 review, Phase 4 fix).
  // This mirrors daily-sheet.service.ts's getRemainingPrevOutstanding +
  // `prevMonthOutstanding - (currentMonthPaid - item.cashCollected)` exactly.
  const remainingForPolicyCheck = Math.max(
    (finSummary?.prevMonthOutstanding ?? 0) - ((finSummary?.currentMonthPaid ?? 0) - savedCash),
    0,
  );

  // Cash Collection Policy validation base — the pre-delivery balance with only
  // this item's own PRIOR saved effect backed out (savedCharge - savedCash),
  // never the new draft cash being typed. Mirrors daily-sheet.service.ts's
  // `currentBalance = customer.financialBalance - priorLedgerEffect` exactly
  // (docs/features/cash-customer-collection-policy.md §4.9). Deliberately NOT
  // liveCurrentOutstanding, which already subtracts draftCash — feeding that in
  // would reproduce the exact parity bug the monthly evaluator mirror had (§10).
  const preDeliveryBalanceForCashPolicy = (finSummary?.currentOutstanding ?? 0) - (savedCharge - savedCash);

  // Collection Policy — real-time mirror of the backend evaluator
  // (docs/features/monthly-customer-collection-policy.md §7.2). Derived state only,
  // recomputed on every keystroke exactly like the live-preview figures above; never
  // persisted anywhere (not in itemForm, not in the sessionStorage draft).
  //
  // isBillingExempt is now part of the shared DeliveryItem.customer type and selected
  // by the sheet-detail query (Phase 4 fix — previously missing, worked around with a
  // defensive cast defaulting to false; see docs/features/monthly-customer-collection-
  // policy.md Phase 3/4 change log entries for the prior gap).
  const isBillingExempt = item.customer?.isBillingExempt ?? false;
  const policyResult: CollectionPolicyResult | null = collectionPolicy
    ? evaluateCollectionPolicy(collectionPolicy, {
        paymentType: item.customer?.paymentType,
        isBillingExempt,
        remainingPreviousOutstanding: remainingForPolicyCheck,
        cashCollected: itemForm.cashCollected ?? 0,
      })
    : null;
  const monthlyLocalViolation = policyResult?.applies && !policyResult.satisfied ? policyResult : null;

  // Cash Collection Policy — real-time mirror of the backend evaluator
  // (docs/features/cash-customer-collection-policy.md §8.3, §10). Same
  // derived-state-only discipline as the monthly mirror above.
  const cashPolicyResult: CashCollectionPolicyResult | null = cashCollectionPolicy
    ? evaluateCashCollectionPolicy(cashCollectionPolicy, {
        paymentType: item.customer?.paymentType,
        isBillingExempt,
        currentBalance: preDeliveryBalanceForCashPolicy,
        chargeAmount: draftCharge,
        cashCollected: itemForm.cashCollected ?? 0,
      })
    : null;
  const cashLocalViolation = cashPolicyResult?.applies && !cashPolicyResult.satisfied ? cashPolicyResult : null;

  // Unified violation — the two policies are mutually exclusive by customer
  // paymentType, so at most one of these is ever non-null. Server backstops
  // (422) take over only when the local mirror didn't already catch it —
  // stale-client / direct-API-call cases.
  const violation: { kind: 'monthly'; result: CollectionPolicyResult } | { kind: 'cash'; result: CashCollectionPolicyResult } | null =
    monthlyLocalViolation
      ? { kind: 'monthly', result: monthlyLocalViolation }
      : cashLocalViolation
        ? { kind: 'cash', result: cashLocalViolation }
        : serverViolation
          ? { kind: 'monthly', result: serverViolation }
          : cashServerViolation
            ? { kind: 'cash', result: cashServerViolation }
            : null;
  const showPolicyViolation = !readOnly && deliveryMode === 'delivered' && !!violation;

  // Bottle wallet preview — wallet balance moves by (dropped − received). The stored
  // wallet value already reflects this item's last save, so back that out first.
  const walletBalance = item.customer?.wallets?.find((w) => w.productId === item.productId)?.balance ?? 0;
  const savedBottleChange = isFirstRecord ? 0 : item.filledDropped - item.emptyReceived;
  const draftBottleChange = deliveryMode === 'delivered'
    ? (itemForm.filledDropped ?? 0) - (itemForm.emptyReceived ?? 0)
    : 0;
  const liveWalletBalance = walletBalance - savedBottleChange + draftBottleChange;

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
          photoKey: photoKey || undefined,
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
          clearDraft(item.id);
          onDone();
        },
        // Backend backstop (docs/features/monthly-customer-collection-policy.md §7.2
        // step 5): covers stale-client / direct-API-call cases the local mirror above
        // didn't already catch. Renders the same warning card using the server's values.
        onError: (error: unknown) => {
          const body = (error as any)?.response?.data; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (body?.code === 'COLLECTION_POLICY_VIOLATION') {
            setServerViolation({
              applies: body.applies,
              satisfied: body.satisfied,
              reason: body.reason,
              requiredAmount: body.requiredAmount,
              collectedAmount: body.collectedAmount,
              remainingPreviousOutstanding: body.remainingPreviousOutstanding,
            });
          } else if (body?.code === 'CASH_COLLECTION_POLICY_VIOLATION') {
            setCashServerViolation({
              applies: body.applies,
              satisfied: body.satisfied,
              reason: body.reason,
              requiredAmount: body.requiredAmount,
              collectedAmount: body.collectedAmount,
              currentBalance: body.currentBalance,
              chargeAmount: body.chargeAmount,
              exposure: body.exposure,
              projectedBalance: body.projectedBalance,
              allowedCreditDeliveries: body.allowedCreditDeliveries,
            });
          }
        },
      },
    );
  };

  return (
    <div className={cn('rounded-2xl border bg-background/70 p-4 space-y-5', readOnly ? 'border-border/50' : 'border-primary/30')}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-black flex items-center gap-2">
          <ClipboardEdit className="h-4 w-4 text-primary" />
          {readOnly ? 'Delivery Record' : isFirstRecord ? 'Record Delivery' : 'Edit Delivery'}
        </p>
        {readOnly && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50 tracking-wide">
            Read Only
          </span>
        )}
      </div>

      {!isFirstRecord && !readOnly && (
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
          onClick={() => !readOnly && setDeliveryMode('delivered')}
          disabled={readOnly}
          className={cn(
            'flex-1 py-2.5 px-2 sm:px-4 rounded-2xl text-xs sm:text-sm font-bold border-2 transition-all',
            readOnly && 'cursor-default',
            deliveryMode === 'delivered'
              ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400'
              : 'bg-background border-border/50 text-muted-foreground hover:border-emerald-500/30',
          )}
        >
          Delivered
        </button>
        <button
          type="button"
          onClick={() => !readOnly && setDeliveryMode('unable')}
          disabled={readOnly}
          className={cn(
            'flex-1 py-2.5 px-2 sm:px-4 rounded-2xl text-xs sm:text-sm font-bold border-2 transition-all',
            readOnly && 'cursor-default',
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
          <div className={cn('grid gap-4', readOnly ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2')}>
            {/* LEFT COLUMN — entry fields stacked vertically */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Dropped</Label>
                <Input
                  type="number"
                  min={0}
                  value={itemForm.filledDropped ?? ''}
                  onChange={(e) => setItemForm((p) => ({ ...p, filledDropped: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className={cn('font-mono font-bold h-11', readOnly && 'bg-muted/40 cursor-default')}
                  readOnly={readOnly}
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
                  value={itemForm.emptyReceived ?? ''}
                  onChange={(e) => setItemForm((p) => ({ ...p, emptyReceived: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className={cn('font-mono font-bold h-11', readOnly && 'bg-muted/40 cursor-default')}
                  readOnly={readOnly}
                />
                <div className="mt-1.5 flex items-center justify-between rounded-xl bg-primary/10 border border-primary/30 px-3 py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-primary">Bottle Wallet</span>
                  <span className="text-lg font-black text-primary leading-none">{liveWalletBalance}<span className="text-xs font-bold ml-1">btl</span></span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Amount (₨)</Label>
                <Input
                  type="number"
                  value={amountDue}
                  disabled
                  readOnly
                  className={cn('font-mono font-bold h-11 bg-muted/50 cursor-not-allowed', readOnly ? 'text-foreground opacity-90' : 'text-muted-foreground')}
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
                  value={itemForm.cashCollected ?? ''}
                  onChange={(e) => setItemForm((p) => ({ ...p, cashCollected: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className={cn(
                    'h-11 font-mono font-bold',
                    showPolicyViolation
                      ? 'bg-destructive/5 border-destructive text-destructive'
                      : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                    readOnly && 'cursor-default',
                  )}
                  readOnly={readOnly}
                />
                {showPolicyViolation && violation && violation.kind === 'monthly' && (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3 text-sm">
                    <span className="text-destructive mt-0.5">⚠</span>
                    <div>
                      <p className="font-bold text-destructive">Collection Policy Not Met</p>
                      <p className="text-xs text-muted-foreground">
                        Cash collected does not satisfy the vendor&apos;s minimum collection
                        policy for the previous month&apos;s outstanding balance. Collect at
                        least <span className="font-bold">₨{violation.result.requiredAmount.toLocaleString()}</span>,
                        or set Cash Collected to 0 if no payment is being collected today.
                      </p>
                    </div>
                  </div>
                )}
                {showPolicyViolation && violation && violation.kind === 'cash' && (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-3 text-sm">
                    <span className="text-destructive mt-0.5">⚠</span>
                    <div>
                      <p className="font-bold text-destructive">Collect at least ₨{violation.result.requiredAmount.toLocaleString()} for this delivery</p>
                      <p className="text-xs text-muted-foreground">
                        The customer&apos;s tab (₨{violation.result.currentBalance.toLocaleString()}) plus
                        today&apos;s bill is above their allowance. Reduce the bottles dropped, or
                        record Unable to Deliver if no payment can be made.
                        {hasOtherUnrecordedItemsForCustomer && (
                          <> Enter the customer&apos;s cash on the first product you record.</>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN — customer financial snapshot (hidden in read-only audit view).
                CASH customers get a credit-policy-oriented panel (§8.3); MONTHLY customers
                keep the existing previous-month-outstanding panel unchanged. */}
            {!readOnly && (
              <div className="grid grid-cols-2 gap-2">
                {finLoading ? (
                  [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[52px] w-full rounded-xl" />)
                ) : item.customer?.paymentType === 'CASH' ? (
                  <>
                    <StatBox label="Current Tab" value={preDeliveryBalanceForCashPolicy} tone="balance" />
                    <StatBox label="Today's Bill" value={draftCharge} tone="neutral" />
                    <StatBox
                      label="Collect At Least"
                      value={cashPolicyResult?.requiredAmount ?? 0}
                      tone={(itemForm.cashCollected ?? 0) >= (cashPolicyResult?.requiredAmount ?? 0) ? 'paid' : 'balance'}
                    />
                    <StatBox label="Tab After" value={liveCurrentOutstanding} tone="balance" />
                  </>
                ) : (
                  <>
                    <StatBox label="Prev Month Bal" value={finSummary?.prevMonthOutstanding ?? 0} tone="balance" />
                    <StatBox label="Paid This Month" value={livePaidThisMonth} tone="paid" />
                    <StatBox label="Prev Month Outstanding" value={livePrevMonthRemaining} tone="balance" />
                    <StatBox label="Current Bal" value={liveCurrentOutstanding} tone="balance" />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottle problem section — only relevant when actively recording */}
          {!readOnly && <div className="rounded-2xl border border-border/40 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (showDamage) {
                  setShowDamage(false);
                  setDamageForm(DEFAULT_DAMAGE_FORM);
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
          </div>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason Category {!readOnly && <span className="text-destructive">*</span>}
            </Label>
            <Select value={failureCategory} onValueChange={readOnly ? undefined : setFailureCategory} disabled={readOnly}>
              <SelectTrigger className={cn('h-11 rounded-xl', readOnly && 'bg-muted/40 cursor-default')}>
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
              Notes {readOnly ? '' : '(optional)'}
            </Label>
            <Input
              placeholder="Additional details..."
              value={unableReason}
              onChange={(e) => setUnableReason(e.target.value)}
              className={cn('h-11', readOnly && 'bg-muted/40 cursor-default')}
              readOnly={readOnly}
            />
          </div>
          {!readOnly && (
            <DeliveryFailurePhotoCapture photoKey={photoKey} onPhotoChange={setPhotoKey} />
          )}
          {!readOnly && (
            <p className="text-[11px] text-muted-foreground bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2">
              This reports an issue for ops planning. Drivers cannot reschedule or cancel from this screen.
            </p>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => { clearDraft(item.id); onDone(); }}
            disabled={isPending}
            className="rounded-xl font-bold"
          >
            Discard
          </Button>
          <Button onClick={doSave} disabled={isPending || showPolicyViolation} className="flex-1 rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Record
          </Button>
        </div>
      )}
    </div>
  );
}
