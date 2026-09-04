import {
  Fuel, Wrench, Wallet, Receipt, Snowflake, PackagePlus, Building2, Users,
  Zap, FileText, Droplet, Package, FlaskConical, Landmark,
  type LucideIcon,
} from 'lucide-react';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';
import { CREATABLE_LEDGER_CATEGORIES, LEDGER_CATEGORY_CONFIG } from '../../payroll/constants';
import type { ExpenseCenterDomain } from '../api/expense-center.api';
import type { ExpenseCategory } from '../../expenses/api/expenses.api';

/**
 * The Add-Expense wizard's type registry (Phase 2a) — one entry per pickable
 * "type" chip in the Step 1 picker. Every non-DISABLED entry must resolve to
 * an EXISTING create endpoint already wired through one of the four reused
 * dialogs (Fuel/Maintenance/Ledger/Crew Cash) or the plain ExpenseForm — this
 * pass adds zero backend surface.
 */
export interface ExpenseTypeEntry {
  key: string;
  label: string;
  domain: ExpenseCenterDomain;
  icon: LucideIcon;
  kind: 'FUEL' | 'MAINTENANCE' | 'LEDGER' | 'CREW_CASH' | 'EXPENSE' | 'DISABLED';
  /** kind: 'LEDGER' only — pre-selects `LogLedgerEntryDialog`'s `defaultCategory`. */
  presetLedgerCategory?: CreatableStaffLedgerCategory;
  /** kind: 'EXPENSE' only — pre-selects `ExpenseForm`'s category (via its `expense` initial-values prop, no `id`). */
  presetExpenseCategory?: ExpenseCategory;
  /** kind: 'EXPENSE' only — Trip Expense variant: offers (but does not require) the sheet-picker step, attaching `dailySheetId` when chosen. */
  needsSheetContext?: boolean;
  /** kind: 'DISABLED' only — why this chip can't be picked yet. */
  disabledNote?: string;
}

const LEDGER_ENTRIES: ExpenseTypeEntry[] = CREATABLE_LEDGER_CATEGORIES.map((cat) => ({
  key: `LEDGER_${cat}`,
  label: LEDGER_CATEGORY_CONFIG[cat].label,
  domain: 'EMPLOYEES',
  icon: LEDGER_CATEGORY_CONFIG[cat].icon,
  kind: 'LEDGER',
  presetLedgerCategory: cat,
}));

export const EXPENSE_TYPE_REGISTRY: ExpenseTypeEntry[] = [
  { key: 'FUEL', label: 'Fuel', domain: 'VEHICLE', icon: Fuel, kind: 'FUEL' },
  { key: 'MAINTENANCE', label: 'Vehicle Maintenance', domain: 'VEHICLE', icon: Wrench, kind: 'MAINTENANCE' },
  ...LEDGER_ENTRIES,
  { key: 'CREW_CASH', label: 'Crew Cash', domain: 'EMPLOYEES', icon: Wallet, kind: 'CREW_CASH' },
  {
    key: 'TRIP_EXPENSE',
    label: 'Trip Expense',
    domain: 'OFFICE',
    icon: Receipt,
    kind: 'EXPENSE',
    presetExpenseCategory: 'OTHER',
    needsSheetContext: true,
  },
  {
    key: 'ICE_PURCHASE',
    label: 'Ice Purchase',
    domain: 'INVENTORY',
    icon: Snowflake,
    kind: 'EXPENSE',
    presetExpenseCategory: 'ICE_PURCHASED',
  },
  {
    key: 'EXTRA_LOADER',
    label: 'Extra Loader',
    domain: 'EMPLOYEES',
    icon: PackagePlus,
    kind: 'EXPENSE',
    presetExpenseCategory: 'EXTRA_LOADER',
  },
  {
    key: 'OFFICE_MISC',
    label: 'Office / Miscellaneous',
    domain: 'OFFICE',
    icon: Building2,
    kind: 'EXPENSE',
    presetExpenseCategory: 'OTHER',
  },
  // Deliberate non-goal — salary is computed automatically from SalaryStructure
  // at pay-period generation time, never hand-entered. No write path exists
  // (or should exist) for it here; see Payroll instead.
  {
    key: 'SALARY',
    label: 'Salary',
    domain: 'EMPLOYEES',
    icon: Users,
    kind: 'DISABLED',
    disabledNote: 'Calculated automatically each pay period — see Payroll',
  },
  {
    key: 'RENT',
    label: 'Rent',
    domain: 'OFFICE',
    icon: Building2,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'UTILITIES',
    label: 'Utilities',
    domain: 'OFFICE',
    icon: Zap,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'STATIONARY',
    label: 'Stationary',
    domain: 'OFFICE',
    icon: FileText,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'BOTTLE_PURCHASE',
    label: 'Bottle Purchase',
    domain: 'INVENTORY',
    icon: Droplet,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'CAPS',
    label: 'Caps',
    domain: 'INVENTORY',
    icon: Package,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'CHEMICALS',
    label: 'Chemicals',
    domain: 'INVENTORY',
    icon: FlaskConical,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
  {
    key: 'VEHICLE_PURCHASE',
    label: 'Vehicle Purchase (Capital)',
    domain: 'CAPITAL',
    icon: Landmark,
    kind: 'DISABLED',
    disabledNote: 'Needs a new expense category — not yet available',
  },
];
