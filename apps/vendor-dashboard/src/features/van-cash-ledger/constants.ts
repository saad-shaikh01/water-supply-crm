import {
  PiggyBank, ArrowDownCircle, PencilLine, ArrowUpCircle, Landmark, Fuel, Wallet, Users,
  Truck, HandCoins, Receipt, type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@water-supply-crm/authz';
import type { CashLedgerBucket, CashLedgerRowType, ManualCashInSource } from './api/van-cash-ledger.api';

/**
 * Spec §4.10 colour semantics: COSTS (expense buckets) are FILLED chips;
 * TRANSFERS (owner transfer / fuel card — not costs) are OUTLINED chips;
 * cash-in buckets are filled emerald / teal. State chips (pending, edited,
 * backdated…) are a separate, neutral vocabulary — never reuse these.
 */
export interface CashLedgerBucketMeta {
  label: string;
  /** Chip classes (filled for cost/cash-in, outlined for transfers). */
  chip: string;
  /** Solid dot / accent bar. */
  dot: string;
  /** Text tone for the bucket's figures. */
  text: string;
  icon: LucideIcon;
  /** true for owner transfer / fuel card — not a cost, excluded from Total Expenses. */
  isTransfer: boolean;
}

export const CASH_LEDGER_BUCKET_META: Record<CashLedgerBucket, CashLedgerBucketMeta> = {
  SHEET_CASH_IN: {
    label: 'Sheet Cash In',
    chip: 'bg-emerald-500/10 text-emerald-500 border-transparent',
    dot: 'bg-emerald-500', text: 'text-emerald-500', icon: Truck, isTransfer: false,
  },
  OFFICE_CASH_IN: {
    label: 'Office Cash In',
    chip: 'bg-teal-500/10 text-teal-500 border-transparent',
    dot: 'bg-teal-500', text: 'text-teal-500', icon: HandCoins, isTransfer: false,
  },
  OFFICE_EXPENSE: {
    label: 'Office Expense',
    chip: 'bg-destructive/10 text-destructive border-transparent',
    dot: 'bg-destructive', text: 'text-destructive', icon: Receipt, isTransfer: false,
  },
  PAYROLL_CASH: {
    label: 'Payroll Cash',
    chip: 'bg-blue-500/10 text-blue-500 border-transparent',
    dot: 'bg-blue-500', text: 'text-blue-500', icon: Users, isTransfer: false,
  },
  CREW_CASH: {
    label: 'Crew Cash',
    chip: 'bg-pink-500/10 text-pink-500 border-transparent',
    dot: 'bg-pink-500', text: 'text-pink-500', icon: Wallet, isTransfer: false,
  },
  OWNER_TRANSFER: {
    label: 'Owner Transfer',
    chip: 'bg-transparent text-violet-500 border-violet-500/50',
    dot: 'bg-violet-500', text: 'text-violet-500', icon: Landmark, isTransfer: true,
  },
  FUEL_CARD: {
    label: 'Fuel Card',
    chip: 'bg-transparent text-orange-500 border-orange-500/50',
    dot: 'bg-orange-500', text: 'text-orange-500', icon: Fuel, isTransfer: true,
  },
};

/** Safe lookup for a row whose `bucket` is missing (older server / stale cache) — falls back to the row-type palette. */
export const cashLedgerBucketMeta = (bucket: CashLedgerBucket | undefined): CashLedgerBucketMeta | null =>
  bucket ? CASH_LEDGER_BUCKET_META[bucket] ?? null : null;

export interface CashLedgerRowMeta {
  label: string;
  /** Chip / badge treatment. */
  color: string;
  /** Solid fill, for the timeline row's leading dot. */
  solid: string;
  /** Tone applied to the row's amount figure. */
  amountClass: string;
  icon: LucideIcon;
}

/**
 * Row-type palette. Reuses the app's established cash vocabulary — teal for
 * cash, destructive/red for a cost figure (see Expense Center's
 * `constants.ts`) — with CASH_IN kept a distinct emerald (success/inflow) and
 * CASH_IN_CORRECTION its own amber so an amended handover never reads as a
 * plain, already-approved CASH_IN row.
 */
export const CASH_LEDGER_ROW_CONFIG: Record<CashLedgerRowType, CashLedgerRowMeta> = {
  OPENING_BALANCE: {
    label: 'Manual Cash In',
    color: 'bg-slate-500/10 text-slate-500',
    solid: 'bg-slate-500',
    amountClass: 'text-slate-400',
    icon: PiggyBank,
  },
  CASH_IN: {
    label: 'Cash In',
    color: 'bg-emerald-500/10 text-emerald-500',
    solid: 'bg-emerald-500',
    amountClass: 'text-emerald-500',
    icon: ArrowDownCircle,
  },
  CASH_IN_CORRECTION: {
    label: 'Correction',
    color: 'bg-amber-500/10 text-amber-500',
    solid: 'bg-amber-500',
    amountClass: 'text-amber-500',
    icon: PencilLine,
  },
  CASH_OUT: {
    label: 'Cash Out',
    color: 'bg-destructive/10 text-destructive',
    solid: 'bg-destructive',
    amountClass: 'text-destructive',
    icon: ArrowUpCircle,
  },
  CASH_REMITTANCE_OUT: {
    label: 'Handover Out',
    color: 'bg-violet-500/10 text-violet-500',
    solid: 'bg-violet-500',
    amountClass: 'text-violet-500',
    icon: Landmark,
  },
  FUEL_CARD_TOPUP_OUT: {
    label: 'Fuel Card Top-up',
    color: 'bg-orange-500/10 text-orange-500',
    solid: 'bg-orange-500',
    amountClass: 'text-orange-500',
    icon: Fuel,
  },
  STANDALONE_CREW_CASH_OUT: {
    label: 'Crew Cash',
    color: 'bg-pink-500/10 text-pink-500',
    solid: 'bg-pink-500',
    amountClass: 'text-pink-500',
    icon: Wallet,
  },
  PAYROLL_SETTLEMENT_OUT: {
    label: 'Payroll Cash',
    color: 'bg-blue-500/10 text-blue-500',
    solid: 'bg-blue-500',
    amountClass: 'text-blue-500',
    icon: Users,
  },
};

/**
 * Cash Ledger date filter: the presets offered and the one that applies while
 * the URL has no `from`/`to`. The data hooks resolve the same default via
 * `resolveCashLedgerRange` (hooks/use-van-cash-ledger.ts).
 */
export const CASH_LEDGER_DATE_PRESETS = ['Today', 'Yesterday', 'This Week', 'This Month', 'Last Month'];
export const CASH_LEDGER_DEFAULT_PRESET = 'This Month';

/** Safe lookup — mirrors Expense Center's `domainMeta` defensive fallback. */
export const cashLedgerRowMeta = (type: CashLedgerRowType | string): CashLedgerRowMeta =>
  CASH_LEDGER_ROW_CONFIG[type as CashLedgerRowType] ?? {
    label: String(type),
    color: 'bg-muted text-muted-foreground',
    solid: 'bg-muted-foreground',
    amountClass: 'text-muted-foreground',
    icon: PencilLine,
  };

/**
 * Permission gates for this feature. `van_cash_ledger` is a brand-new RBAC
 * resource (added to the shared catalog alongside this feature — see
 * `libs/shared/authz/src/lib/permissions.ts`), granted by default to
 * Admin + Manager (see `presets.ts` / `PRESET_DRIFT_BACKFILLS.manager`).
 */
export const VAN_CASH_LEDGER_PERMISSIONS = {
  approve: 'van_cash_ledger:approve' as Permission,
  manage: 'van_cash_ledger:manage' as Permission,
  remit: 'van_cash_ledger:remit' as Permission,
  remitApprove: 'van_cash_ledger:remit_approve' as Permission,
  remitVoid: 'van_cash_ledger:remit_void' as Permission,
  /** P5 — CSV exports (timeline / daily table) and the daily cash report PDF. */
  export: 'van_cash_ledger:export' as Permission,
};

/** Manual cash-in categorisation (P2) — labels for the optional "Source" select and history display. */
export const MANUAL_CASH_IN_SOURCES: ReadonlyArray<{ value: ManualCashInSource; label: string }> = [
  { value: 'OWNER_INJECTION', label: 'Owner added cash' },
  { value: 'OPENING_BALANCE', label: 'Opening balance' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'BANK_WITHDRAWAL', label: 'Bank withdrawal' },
  { value: 'OTHER', label: 'Other' },
];

export const manualCashInSourceLabel = (source: ManualCashInSource | null | undefined): string | null =>
  MANUAL_CASH_IN_SOURCES.find((s) => s.value === source)?.label ?? null;
