import { z } from 'zod';

export const generateSheetSchema = z.object({
  date: z.string().min(1, 'Date is required'),
});

export const loadOutSchema = z.object({
  filledOutCount: z.coerce.number().min(0, 'Must be 0 or more'),
});

export const checkInSchema = z.object({
  filledInCount: z.coerce.number().min(0).default(0),
  emptyInCount: z.coerce.number().min(0).default(0),
  cashCollected: z.coerce.number().min(0).default(0),
});

export const deliveryItemSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'EMPTY_ONLY', 'NOT_AVAILABLE', 'RESCHEDULED', 'CANCELLED']),
  filledDropped: z.coerce.number().min(0).default(0),
  emptyReceived: z.coerce.number().min(0).default(0),
  cashCollected: z.coerce.number().min(0).default(0),
  reason: z.string().optional(),
});

export type GenerateSheetInput = z.infer<typeof generateSheetSchema>;
export type LoadOutInput = z.infer<typeof loadOutSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
export type DeliveryItemInput = z.infer<typeof deliveryItemSchema>;
