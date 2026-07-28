import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Email or Phone Number is required'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const activationEligibilitySchema = z.object({
  customerCode: z.string().min(1, 'Customer code is required'),
  phoneNumber: z.string().min(1, 'Phone number is required'),
});

export const activationPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ActivationEligibilityInput = z.infer<typeof activationEligibilitySchema>;
export type ActivationPasswordInput = z.infer<typeof activationPasswordSchema>;
