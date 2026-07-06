import { z } from 'zod';

/** Field-staff roles that work on vans but never log in. */
export const NO_LOGIN_ROLES = ['SALESMAN', 'LOADER'] as const;

export const isNoLoginRole = (role?: string) =>
  (NO_LOGIN_ROLES as readonly string[]).includes(role ?? '');

export const userSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Valid email required').optional().or(z.literal('')),
    password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
    phoneNumber: z.string().optional().or(z.literal('')),
    role: z.enum(['VENDOR_ADMIN', 'STAFF', 'DRIVER', 'SALESMAN', 'LOADER']),
  })
  .superRefine((data, ctx) => {
    // Email is required for login-capable roles; salesmen/loaders can be
    // created with just a name (+ optional phone).
    if (!isNoLoginRole(data.role) && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Email is required for this role',
      });
    }
  });

export type UserInput = z.infer<typeof userSchema>;
