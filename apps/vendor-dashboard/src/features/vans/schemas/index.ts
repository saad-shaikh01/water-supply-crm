import { z } from 'zod';

export const vanSchema = z.object({
  plateNumber: z.string().min(2, 'Plate number is required'),
  model: z.string().optional(),
  capacity: z.number().positive().optional(),
});

export type VanInput = z.infer<typeof vanSchema>;
