import {
  Truck, Users, Building2, Package, Landmark, AlertTriangle, ClipboardList, Wallet, Wrench, Banknote, FileEdit, type LucideIcon,
} from 'lucide-react';
import type { ExpenseCenterDomain, ExpenseCenterSourceBucket } from './api/expense-center.api';

export interface DomainMeta {
  label: string;
  /** Chip / tile treatment — mirrors `CATEGORY_CONFIG.color` in expense-list.tsx. */
  color: string;
  /** Solid fill, for the segmented breakdown bar and the timeline row dots. */
  solid: string;
  icon: LucideIcon;
}

/**
 * Domain palette. Six hues, each distinct from one another *and* from the
 * colours this app already spends semantically elsewhere:
 *   destructive/red = a cost figure, emerald = success/toggle-on,
 *   blue-500 = card payment, teal-500 = cash, orange-500 = Fuel,
 *   cyan-600 = Ice Purchased, purple-500 = Extra Loader, yellow-600 = Lunch.
 * INVENTORY deliberately avoids orange-600 (too close to Fuel's orange-500)
 * and teal (already means "cash"), landing on lime-600 instead.
 */
export const DOMAIN_CONFIG: Record<ExpenseCenterDomain, DomainMeta> = {
  VEHICLE:     { label: 'Vehicle',     color: 'bg-sky-600/10 text-sky-600',       solid: 'bg-sky-600',     icon: Truck },
  EMPLOYEES:   { label: 'Employees',   color: 'bg-violet-500/10 text-violet-500', solid: 'bg-violet-500',  icon: Users },
  OFFICE:      { label: 'Office',      color: 'bg-amber-700/10 text-amber-700',   solid: 'bg-amber-700',   icon: Building2 },
  INVENTORY:   { label: 'Inventory',   color: 'bg-lime-600/10 text-lime-600',     solid: 'bg-lime-600',    icon: Package },
  CAPITAL:     { label: 'Capital',     color: 'bg-slate-500/10 text-slate-500',   solid: 'bg-slate-500',   icon: Landmark },
  DISCREPANCY: { label: 'Discrepancy', color: 'bg-rose-600/10 text-rose-600',     solid: 'bg-rose-600',    icon: AlertTriangle },
};

export const EXPENSE_CENTER_DOMAINS = Object.keys(DOMAIN_CONFIG) as ExpenseCenterDomain[];

/** Safe lookup — the backend may add a domain before this map catches up. */
export const domainMeta = (domain: ExpenseCenterDomain | string): DomainMeta =>
  DOMAIN_CONFIG[domain as ExpenseCenterDomain] ?? {
    label: String(domain),
    color: 'bg-muted text-muted-foreground',
    solid: 'bg-muted-foreground',
    icon: AlertTriangle,
  };

/**
 * Recording-surface palette — which flow the row was captured through, not
 * what it was spent on (that's `DOMAIN_CONFIG`). Colours deliberately reuse
 * none of the domain hues so the two badges never get visually confused
 * sitting side by side on a timeline row.
 */
export const SOURCE_BUCKET_CONFIG: Record<ExpenseCenterSourceBucket, DomainMeta> = {
  DAILY_SHEET: { label: 'Daily Sheet',    color: 'bg-indigo-500/10 text-indigo-500', solid: 'bg-indigo-500', icon: ClipboardList },
  CASH_LEDGER: { label: 'Cash Ledger',    color: 'bg-teal-500/10 text-teal-500',     solid: 'bg-teal-500',   icon: Wallet },
  FLEET:       { label: 'Fleet',          color: 'bg-orange-500/10 text-orange-500', solid: 'bg-orange-500', icon: Wrench },
  PAYROLL:     { label: 'Payroll',        color: 'bg-fuchsia-500/10 text-fuchsia-500', solid: 'bg-fuchsia-500', icon: Banknote },
  EXPENSES:    { label: 'Direct Expense', color: 'bg-slate-400/10 text-slate-400',   solid: 'bg-slate-400',  icon: FileEdit },
};

export const EXPENSE_CENTER_SOURCE_BUCKETS = Object.keys(SOURCE_BUCKET_CONFIG) as ExpenseCenterSourceBucket[];

/** Safe lookup — the backend may add a bucket before this map catches up. */
export const sourceBucketMeta = (source: ExpenseCenterSourceBucket | string): DomainMeta =>
  SOURCE_BUCKET_CONFIG[source as ExpenseCenterSourceBucket] ?? {
    label: String(source),
    color: 'bg-muted text-muted-foreground',
    solid: 'bg-muted-foreground',
    icon: AlertTriangle,
  };
