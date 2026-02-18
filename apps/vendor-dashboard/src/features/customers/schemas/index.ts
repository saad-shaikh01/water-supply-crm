import { z } from 'zod';

export const customerSchema = z.object({
  customerCode: z.string().min(2, 'Code is required'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phoneNumber: z.string().min(10, 'Valid phone number required'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  routeId: z.string().uuid('Valid Route is required'),
  deliveryDays: z.array(z.number()).min(1, 'Select at least one delivery day'),
  paymentType: z.enum(['MONTHLY', 'CASH']).default('CASH'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const customPriceSchema = z.object({
  productId: z.string().uuid('Product is required'),
  price: z.number().positive('Price must be positive'),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomPriceInput = z.infer<typeof customPriceSchema>;
