import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Password must be at least 6 characters'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/** Recovery codes look like XXXXX-XXXXX (dash and case are ignored by the server). */
export const recoveryCodeSchema = z.object({
  recoveryCode: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.replace(/-/g, '').length === 10, 'Enter the 10-character recovery code'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(12, 'New password must be at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] });

export type TotpCodeInput = z.infer<typeof totpCodeSchema>;
export type RecoveryCodeInput = z.infer<typeof recoveryCodeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
