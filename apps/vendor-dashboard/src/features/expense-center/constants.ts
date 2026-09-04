import {
  Truck, Users, Building2, Package, Landmark, AlertTriangle, type LucideIcon,
} from 'lucide-react';
import type { ExpenseCenterDomain } from './api/expense-center.api';

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
