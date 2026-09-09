import {
  PiggyBank, ArrowDownCircle, PencilLine, ArrowUpCircle, type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@water-supply-crm/authz';
import type { CashLedgerRowType } from './api/van-cash-ledger.api';

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
    label: 'Opening Balance',
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
};

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
};
