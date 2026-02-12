'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import {
  Button, Input, Label, Card, CardContent,
  CardDescription, CardFooter, CardHeader, CardTitle,
} from '@water-supply-crm/ui';
import { forgotPasswordSchema, type ForgotPasswordInput } from '../schemas';
import { useForgotPassword } from '../hooks/use-auth';

export function ForgotPasswordForm() {
  const { mutate: sendReset, isPending } = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Forgot Password</CardTitle>
        <CardDescription>Enter your email to receive a password reset link</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit((data) => sendReset(data.email))}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@example.com" {...register('email')} />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <Link href="/auth/login" className="text-sm text-center text-primary hover:underline">
            Back to Sign In
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
