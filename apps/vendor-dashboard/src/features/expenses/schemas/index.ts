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
  category: z.enum([
    'LUNCH_EXPENSE_EMPLOYEE', 'ADVANCE_SALARY_EMPLOYEE', 'VEHICLE_MAINTENANCE',
    'FUEL_EXPENSE', 'ICE_PURCHASED', 'EXTRA_LOADER', 'OTHER',
  ]),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  vanId: z.string().optional(),
  // true = paid from the driver's van cash-in-hand (default — deducted from
  // cash hand-in); false = paid by card/bank/company account (not deducted).
  paidFromCash: z.boolean(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
