'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, ResetPasswordInput } from '../schemas';
import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@water-supply-crm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '../api/auth.api';
import { apiErrorMessage } from '../../../lib/api-error';
import { ErrorState } from '../../../components/shared/error-state';

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams()?.get('token');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  if (!token) {
    return (
      <div className="w-full max-w-md mx-auto">
        <ErrorState
          title="Invalid or missing reset link"
          error={{ response: { data: { message: 'Request a new password reset link and try again.' } } }}
        />
      </div>
    );
  }

  const onSubmit = async (data: ResetPasswordInput) => {
    setSubmitError(null);
    try {
      await authApi.resetPassword(token, data.password);
      router.replace('/auth/login?reset=success');
    } catch (e) {
      setSubmitError(apiErrorMessage(e, 'Could not reset the password. The link may have expired.'));
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Reset Password</CardTitle>
        <CardDescription>Enter your new password below.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
