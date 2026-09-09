import { z } from 'zod';

export const expenseSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  // Full enum accepted here (not just the selectable CATEGORIES list in
  // expense-form.tsx) so editing an existing expense that still carries a
  // retired category (LUNCH_EXPENSE_EMPLOYEE/ADVANCE_SALARY_EMPLOYEE/
  // FUEL_EXPENSE, dropped from the dropdown 2026-08-21) doesn't fail
  // validation when its category isn't touched. New submissions can only
  // ever produce one of the dropdown's values, since that's all the <Select>
  // lets a user pick.
  //
  // BUGFIX 2026-09-09: this list had silently fallen out of sync with
  // expense-form.tsx's CATEGORIES/ExpenseCategory across three rounds of new
  // categories (2026-09-07/08/09) — every one of those 13 values was
  // selectable in the dropdown but rejected by this schema on submit,
  // blocking the form entirely. Kept in sync with expenses.api.ts's
  // `ExpenseCategory` type, which is the source of truth for the full set.
  category: z.enum([
    'LUNCH_EXPENSE_EMPLOYEE', 'ADVANCE_SALARY_EMPLOYEE', 'VEHICLE_MAINTENANCE',
    'FUEL_EXPENSE', 'ICE_PURCHASED', 'EXTRA_LOADER', 'OTHER',
    'RENT', 'UTILITIES', 'STATIONARY',
    'BOTTLE_PURCHASED', 'CAPS_PURCHASED', 'CHEMICALS_PURCHASED',
    'POLICE', 'MOBILE_LOAD', 'PSQCA',
    'BOTTLE_REPAIR', 'CONTRACTOR_PAYMENT', 'CHARITY',
    'VEHICLE_RENT',
  ]),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  vanId: z.string().optional(),
  // true = paid from the driver's van cash-in-hand (default — deducted from
  // cash hand-in); false = paid by card/bank/company account (not deducted).
  paidFromCash: z.boolean(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
