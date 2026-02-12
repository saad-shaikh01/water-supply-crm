import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  price: z.number().positive('Price must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  isActive: z.boolean(),
});

export type ProductInput = z.infer<typeof productSchema>;
