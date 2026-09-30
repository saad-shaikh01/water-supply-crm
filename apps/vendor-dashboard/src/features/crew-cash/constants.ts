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

/** Every category that can exist on a row — display, filters, legacy data. Never shrink this: old rows still carry these values. */
export const CREW_CASH_CATEGORIES = Object.keys(CREW_CASH_CATEGORY_CONFIG) as CrewCashCategory[];

/** Categories offered when recording new entries. The rest are retired but stay in the enum/config so history renders. */
export const CREW_CASH_SELECTABLE_CATEGORIES: CrewCashCategory[] = ['MEAL'];

/** Selectable list for a form; keeps an edited entry's retired category visible so it isn't silently blanked. */
export const selectableCrewCashCategories = (current?: string | null): CrewCashCategory[] =>
  current && (CREW_CASH_CATEGORIES as string[]).includes(current) && !CREW_CASH_SELECTABLE_CATEGORIES.includes(current as CrewCashCategory)
    ? [...CREW_CASH_SELECTABLE_CATEGORIES, current as CrewCashCategory]
    : CREW_CASH_SELECTABLE_CATEGORIES;
