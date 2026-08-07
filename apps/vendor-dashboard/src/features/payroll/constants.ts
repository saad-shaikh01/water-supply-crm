import {
  HandCoins, Receipt, Gift, Star, Clock3, TriangleAlert, MinusCircle,
  CalendarX, CalendarCheck, Scale, type LucideIcon,
} from 'lucide-react';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';

/**
 * Sign convention for `StaffLedgerEntry.amount` — confirmed against the backend, not
 * assumed. `CreateStaffLedgerEntryDto.amount` is stored as-is by
 * `StaffLedgerService.createTx` (`amount: dto.amount`, no server-side sign derivation),
 * and `PayrollEntryService.bucketKeyForCategory`/`computeEntryBreakdown` sum every
 * bucket flatly into `finalPayable` assuming amounts already carry the correct sign.
 * The fixture data in `payroll-entry.service.spec.ts` / `payroll-integration.spec.ts`
 * confirms the direction per category: ADVANCE -5000, PENALTY -500/-5000,
 * DEDUCTION -200 (debits); EXPENSE_REIMBURSEMENT +2000, BONUS +1000, OVERTIME +300,
 * INCENTIVE +700, LEAVE_PAID +100 (credits). LEAVE_UNPAID has no direct fixture but is
 * a debit by construction (salary assumes full attendance; unpaid leave subtracts pay
 * for days not worked). ADJUSTMENT is the one genuinely bidirectional category (§9:
 * "manual corrections, ad hoc penalties, anything not fitting the above") — its sign
 * is NOT fixed here; the Log Ledger Entry dialog asks the user to pick Credit/Debit
 * explicitly for it instead of silently defaulting a direction.
 */
export const LEDGER_CATEGORY_SIGN: Record<Exclude<CreatableStaffLedgerCategory, 'ADJUSTMENT'>, 1 | -1> = {
  ADVANCE: -1,
  EXPENSE_REIMBURSEMENT: 1,
  BONUS: 1,
  INCENTIVE: 1,
  OVERTIME: 1,
  PENALTY: -1,
  DEDUCTION: -1,
  LEAVE_UNPAID: -1,
  LEAVE_PAID: 1,
};

export interface LedgerCategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Fixed sign for this category, or 'variable' for ADJUSTMENT (user picks credit/debit). */
  sign: 1 | -1 | 'variable';
}

export const LEDGER_CATEGORY_CONFIG: Record<CreatableStaffLedgerCategory, LedgerCategoryMeta> = {
  ADVANCE: { label: 'Advance', icon: HandCoins, sign: -1 },
  EXPENSE_REIMBURSEMENT: { label: 'Expense / Reimbursement', icon: Receipt, sign: 1 },
  BONUS: { label: 'Bonus', icon: Gift, sign: 1 },
  INCENTIVE: { label: 'Incentive', icon: Star, sign: 1 },
  OVERTIME: { label: 'Overtime', icon: Clock3, sign: 1 },
  PENALTY: { label: 'Penalty', icon: TriangleAlert, sign: -1 },
  DEDUCTION: { label: 'Deduction', icon: MinusCircle, sign: -1 },
  LEAVE_UNPAID: { label: 'Unpaid Leave', icon: CalendarX, sign: -1 },
  LEAVE_PAID: { label: 'Paid Leave', icon: CalendarCheck, sign: 1 },
  ADJUSTMENT: { label: 'Adjustment', icon: Scale, sign: 'variable' },
};

export const CREATABLE_LEDGER_CATEGORIES = Object.keys(LEDGER_CATEGORY_CONFIG) as CreatableStaffLedgerCategory[];

/** Payroll-eligible roles — mirrors `PAYROLL_ELIGIBLE_ROLES` in `payroll-entry.service.ts`. */
export const PAYROLL_ELIGIBLE_ROLES = ['STAFF', 'DRIVER', 'SALESMAN', 'LOADER'] as const;
