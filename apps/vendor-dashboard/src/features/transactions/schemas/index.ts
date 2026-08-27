import { z } from 'zod';

export const paymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
});

export const adjustmentSchema = z.object({
  amount: z.number(),
  type: z.enum(['CREDIT', 'DEBIT']),
  reason: z.string().min(2, 'Reason is required'),
});

/** Correction-reason enum keys shared by the edit + delete payment flows. */
export const PAYMENT_EDIT_REASONS = [
  'WRONG_AMOUNT',
  'CASH_RECOUNTED',
  'DUPLICATE_ENTRY',
  'WRONG_CUSTOMER',
  'CUSTOMER_REQUESTED',
  'OTHER',
] as const;

// `reasonNote` is required (min 3 chars) only when reason === 'OTHER'.
const requireNoteForOther = (
  data: { reason: string; reasonNote?: string },
  ctx: z.RefinementCtx,
) => {
  if (data.reason === 'OTHER' && (data.reasonNote?.trim().length ?? 0) < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasonNote'],
      message: 'Please describe the reason (at least 3 characters).',
    });
  }
};

export const editPaymentSchema = z
  .object({
    amount: z.number().positive('Amount must be positive'),
    description: z.string().optional(),
    reason: z.enum(PAYMENT_EDIT_REASONS),
    reasonNote: z.string().optional(),
  })
  .superRefine(requireNoteForOther);

export const deletePaymentSchema = z
  .object({
    reason: z.enum(PAYMENT_EDIT_REASONS),
    reasonNote: z.string().optional(),
  })
  .superRefine(requireNoteForOther);

export type PaymentInput = z.infer<typeof paymentSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type EditPaymentInput = z.infer<typeof editPaymentSchema>;
export type DeletePaymentInput = z.infer<typeof deletePaymentSchema>;
