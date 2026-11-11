import { z } from 'zod';
import { passwordRule } from './index';

export const resetPasswordSchema = z
  .object({
    adminUserId: z.string().optional(),
    newPassword: passwordRule,
    confirmPassword: z.string().min(1, 'Confirm the new password'),
    superAdminPassword: z.string().min(1, 'Enter your own password to confirm'),
    reason: z.string().trim().max(200, 'Reason must be at most 200 characters').optional(),
    deliveryAck: z.boolean().refine((v) => v === true, 'Confirm you will deliver the password securely'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
