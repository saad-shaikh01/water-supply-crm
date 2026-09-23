import { z } from 'zod';

export const vanSchema = z.object({
  plateNumber: z.string().min(2, 'Plate number is required'),
  defaultDriverId: z.string().uuid('Valid driver is required').optional().nullable(),
  defaultSalesmanId: z.string().uuid('Valid salesman is required').optional().nullable(),
});

export type VanInput = z.infer<typeof vanSchema>;
