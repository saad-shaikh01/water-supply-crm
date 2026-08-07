import { Utensils, Coffee, Droplet, Cookie, Wallet, Siren, HelpCircle, type LucideIcon } from 'lucide-react';
import type { CrewCashCategory } from '@water-supply-crm/types';

/** Fixed category set (doc §5) — one enum, reporting/labeling dimension only, never vendor-configurable in v1. */
export const CREW_CASH_CATEGORY_CONFIG: Record<CrewCashCategory, { label: string; color: string; icon: LucideIcon }> = {
  MEAL:              { label: 'Meal',            color: 'bg-amber-500/10 text-amber-600',     icon: Utensils },
  TEA:               { label: 'Tea',             color: 'bg-orange-500/10 text-orange-500',   icon: Coffee },
  WATER:             { label: 'Water',           color: 'bg-sky-500/10 text-sky-500',         icon: Droplet },
  SNACKS:            { label: 'Snacks',          color: 'bg-yellow-500/10 text-yellow-600',   icon: Cookie },
  OPERATIONAL_CASH:  { label: 'Operational Cash', color: 'bg-blue-500/10 text-blue-500',      icon: Wallet },
  EMERGENCY_CASH:    { label: 'Emergency Cash',  color: 'bg-destructive/10 text-destructive', icon: Siren },
  OTHER:             { label: 'Other',           color: 'bg-muted text-muted-foreground',     icon: HelpCircle },
};

export const CREW_CASH_CATEGORIES = Object.keys(CREW_CASH_CATEGORY_CONFIG) as CrewCashCategory[];
