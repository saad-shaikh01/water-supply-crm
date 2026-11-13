'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, LoginInput } from '../schemas';
import { useLogin } from '../hooks/use-auth';
import { isEnrollmentRequired, isLoginTokens, isTwoFactorChallenge } from '../api/auth.api';
import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@water-supply-crm/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { TwoFactorStep } from './two-factor-step';
import { Enroll2faStep } from './enroll-2fa-step';
import { ChangePasswordStep } from './change-password-step';

const BANNERS: Record<string, { text: string; tone: 'info' | 'error' }> = {
  forbidden: { text: 'This panel is for platform administrators only.', tone: 'error' },
  expired: { text: 'Your session has expired. Please sign in again.', tone: 'info' },
  success: { text: 'Your password has been reset. Please sign in.', tone: 'info' },
};

function useBanner() {
  const params = useSearchParams();
  const reason = params?.get('reason');
  if (reason && BANNERS[reason]) return BANNERS[reason];
  if (params?.get('reset') === 'success') return BANNERS['success'];
  return null;
}

type Step =
  | { kind: 'credentials' }
  | { kind: 'challenge'; token: string }
  | { kind: 'enroll'; token: string }
  | { kind: 'change-password' };

const TITLES: Record<Step['kind'], { title: string; description: string }> = {
  credentials: { title: 'Login', description: 'Enter your credentials to access your account' },
  challenge: { title: 'Two-factor authentication', description: 'Enter the code from your authenticator app' },
  enroll: { title: 'Set up two-factor authentication', description: 'Required before you can continue' },
  'change-password': { title: 'Change your password', description: 'A new password is required' },
};

export function LoginForm() {
  const router = useRouter();
  const { mutate: login, isPending } = useLogin();
  const banner = useBanner();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data: LoginInput) => {
    login(data, {
      onSuccess: (res) => {
        if (isTwoFactorChallenge(res)) setStep({ kind: 'challenge', token: res.challengeToken });
        else if (isEnrollmentRequired(res)) setStep({ kind: 'enroll', token: res.enrollmentToken });
        else if (isLoginTokens(res) && res.user.mustChangePassword) setStep({ kind: 'change-password' });
      },
    });
  };

  const back = () => setStep({ kind: 'credentials' });
  const goHome = () => router.replace('/');
  const afterAuth = (mustChange?: boolean) => (mustChange ? setStep({ kind: 'change-password' }) : goHome());

  const head = TITLES[step.kind];

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{head.title}</CardTitle>
        <CardDescription>{head.description}</CardDescription>
      </CardHeader>
      {banner && step.kind === 'credentials' && (
        <div
          role="status"
          data-testid="login-banner"
          className={
            banner.tone === 'error'
              ? 'mx-6 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
              : 'mx-6 mb-2 rounded-md border bg-muted px-3 py-2 text-sm'
          }
        >
          {banner.text}
        </div>
      )}
      {step.kind === 'challenge' && (
        <TwoFactorStep challengeToken={step.token} onBack={back} onVerified={(d) => afterAuth(d.user.mustChangePassword)} />
      )}
      {step.kind === 'enroll' && (
        <Enroll2faStep enrollmentToken={step.token} onBack={back} onDone={(d) => afterAuth(d.user.mustChangePassword)} />
      )}
      {step.kind === 'change-password' && <ChangePasswordStep onDone={goHome} />}
      {step.kind === 'credentials' && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email</Label>
              <Input id="identifier" type="email" placeholder="admin@example.com" {...register('identifier')} />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier.message}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/auth/forgot-password" className="text-sm text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input id="password" type="password" {...register('password')} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Logging in...' : 'Login'}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
