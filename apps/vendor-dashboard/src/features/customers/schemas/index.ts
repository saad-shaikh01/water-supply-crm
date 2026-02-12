import { z } from 'zod';

export const customerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().min(10, 'Valid phone number required'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  routeId: z.string().min(1, 'Route is required'),
  bottleCount: z.number().min(0),
});

export const customPriceSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  price: z.number().positive('Price must be positive'),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomPriceInput = z.infer<typeof customPriceSchema>;
