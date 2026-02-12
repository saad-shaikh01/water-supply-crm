import { z } from 'zod';

export const paymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  notes: z.string().optional(),
});

export const adjustmentSchema = z.object({
  amount: z.number(),
  type: z.enum(['CREDIT', 'DEBIT']),
  reason: z.string().min(2, 'Reason is required'),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
