import { z } from 'zod';

/** Mirrors the API (CreateVendorDto / ResetAdminPasswordDto): 8-72 chars, at least one letter and one digit. */
export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Password must contain at least one letter and one digit');

export const slugRule = z
  .string()
  .min(2, 'Slug must be 2-50 characters')
  .max(50, 'Slug must be 2-50 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug: lowercase letters, digits and single hyphens only');

/** Wizard step 1: company. */
export const companyStepSchema = z.object({
  name: z.string().trim().min(2, 'Vendor name is required').max(120, 'Vendor name is too long'),
  slug: slugRule,
  address: z.string().trim().max(500, 'Address is too long').optional(),
});

/** Wizard step 2: admin account. */
export const adminStepSchema = z.object({
  adminName: z.string().trim().min(2, 'Admin name is required').max(100, 'Admin name is too long'),
  adminEmail: z.string().trim().toLowerCase().email('Valid email required'),
  adminPassword: passwordRule,
});

export const createVendorSchema = companyStepSchema.merge(adminStepSchema);

/** The slug is immutable server-side (UpdateVendorDto has no slug), so it is NOT part of the edit payload. */
export const editVendorSchema = z.object({
  name: z.string().trim().min(2, 'Vendor name is required').max(120, 'Vendor name is too long'),
  address: z.string().trim().max(500, 'Address is too long').optional(),
  raastId: z.string().trim().max(100, 'Raast ID is too long').optional(),
});

export type CompanyStepInput = z.infer<typeof companyStepSchema>;
export type AdminStepInput = z.infer<typeof adminStepSchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type EditVendorInput = z.infer<typeof editVendorSchema>;
