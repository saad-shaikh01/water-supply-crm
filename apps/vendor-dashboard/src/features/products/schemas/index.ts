import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  basePrice: z.number().min(0, 'Price must be 0 or more'),
});

export type ProductInput = z.infer<typeof productSchema>;
