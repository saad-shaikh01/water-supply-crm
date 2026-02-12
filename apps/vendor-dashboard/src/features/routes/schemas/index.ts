import { z } from 'zod';

export const routeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  driverId: z.string().optional(),
  vanId: z.string().optional(),
});

export type RouteInput = z.infer<typeof routeSchema>;
