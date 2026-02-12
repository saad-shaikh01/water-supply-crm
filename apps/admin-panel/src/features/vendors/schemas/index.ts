import { z } from 'zod';

export const createVendorSchema = z.object({
  name: z.string().min(2, 'Vendor name is required'),
  slug: z.string().min(2, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, hyphens only'),
  adminName: z.string().min(2, 'Admin name is required'),
  adminEmail: z.string().email('Valid email required'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const editVendorSchema = z.object({
  name: z.string().min(2, 'Vendor name is required'),
  slug: z.string().min(2, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, hyphens only'),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type EditVendorInput = z.infer<typeof editVendorSchema>;
