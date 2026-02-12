import { z } from 'zod';

export const generateSheetSchema = z.object({
  routeId: z.string().min(1, 'Route is required'),
  vanId: z.string().min(1, 'Van is required'),
  driverId: z.string().min(1, 'Driver is required'),
  date: z.string().min(1, 'Date is required'),
});

export const checkInSchema = z.object({
  emptiesReturned: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
});

export type GenerateSheetInput = z.infer<typeof generateSheetSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;
