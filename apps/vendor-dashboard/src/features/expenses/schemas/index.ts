import { z } from 'zod';

export const expenseSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  category: z.enum(['LUNCH_EXPENSE_EMPLOYEE', 'ADVANCE_SALARY_EMPLOYEE', 'VEHICLE_MAINTENANCE', 'FUEL_EXPENSE', 'OTHER']),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  vanId: z.string().optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
