'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Droplets } from 'lucide-react';
import { Button, Input, Label, Card, CardContent } from '@water-supply-crm/ui';
import { forgotPasswordSchema, type ForgotPasswordInput } from '../schemas';
import { toast } from 'sonner';
import Link from 'next/link';
import { authApi } from '../api/auth.api';

export function ForgotPasswordForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    try {
      await authApi.forgotPassword({ email: data.email });
      toast.success('If that email exists, a reset link has been sent.');
    } catch {
      // Always show success message to prevent email enumeration
      toast.success('If that email exists, a reset link has been sent.');
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-2">
          <Droplets className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">Reset Password</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we&apos;ll send a reset link</p>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-2xl">
        <CardContent className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="h-11"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-[10px] font-bold text-destructive">{errors.email.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11 font-bold rounded-xl" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              Activated with a Customer Code instead of an email?{' '}
              <Link href="/auth/reset-with-code" className="text-primary font-semibold hover:underline">
                Reset here
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Remember your password?{' '}
        <Link href="/auth/login" className="text-primary hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
