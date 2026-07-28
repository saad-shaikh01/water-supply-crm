'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { toast } from 'sonner';
import { Droplets, KeyRound, ShieldCheck, Loader2, ArrowRight, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, Button, Input, Label } from '@water-supply-crm/ui';
import {
  activationEligibilitySchema,
  activationPasswordSchema,
  type ActivationEligibilityInput,
  type ActivationPasswordInput,
} from '../schemas';
import { useCheckEligibility, useActivateAccount, useResetPasswordWithCode } from '../hooks/use-auth';

type Mode = 'activate' | 'reset';

interface VerifiedIdentity extends ActivationEligibilityInput {
  customerName: string;
}

const COPY: Record<Mode, {
  title: string;
  introSubtitle: string;
  passwordSubtitle: string;
  wrongStateMessage: string;
  wrongStateLinkHref: string;
  wrongStateLinkLabel: string;
  passwordLabel: string;
  submitLabel: string;
  submittingLabel: string;
  confirmationVerb: string;
}> = {
  activate: {
    title: 'Activate Your Account',
    introSubtitle: 'Enter your Customer Code and registered phone number to get started.',
    passwordSubtitle: 'Choose a password to finish setting up your account.',
    wrongStateMessage: 'This account is already activated.',
    wrongStateLinkHref: '/auth/reset-with-code',
    wrongStateLinkLabel: 'Reset your password instead',
    passwordLabel: 'New Password',
    submitLabel: 'Activate Account',
    submittingLabel: 'Activating...',
    confirmationVerb: 'Activating account for',
  },
  reset: {
    title: 'Reset Your Password',
    introSubtitle: "Enter your Customer Code and registered phone number to verify it's you.",
    passwordSubtitle: 'Choose a new password for your account.',
    wrongStateMessage: "This account hasn't been activated yet.",
    wrongStateLinkHref: '/auth/activate',
    wrongStateLinkLabel: 'Activate your account instead',
    passwordLabel: 'New Password',
    submitLabel: 'Reset Password',
    submittingLabel: 'Resetting...',
    confirmationVerb: 'Resetting password for',
  },
};

function IdentityStep({ mode, onVerified }: { mode: Mode; onVerified: (identity: VerifiedIdentity) => void }) {
  const copy = COPY[mode];
  const { mutate: checkEligibility, isPending } = useCheckEligibility();
  const [wrongState, setWrongState] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivationEligibilityInput>({
    resolver: zodResolver(activationEligibilitySchema),
  });

  const onSubmit = (data: ActivationEligibilityInput) => {
    setWrongState(false);
    checkEligibility(data, {
      onSuccess: ({ data: result }) => {
        if (!result.eligible) {
          toast.error(result.reason ?? 'Unable to verify your account.');
          return;
        }
        // activate mode expects an unactivated customer; reset mode expects an activated one.
        const expectsAlreadyActivated = mode === 'reset';
        if (!!result.alreadyActivated !== expectsAlreadyActivated) {
          setWrongState(true);
          return;
        }
        onVerified({ ...data, customerName: result.customerName ?? '' });
      },
      onError: () => toast.error('Unable to verify your account. Please try again.'),
    });
  };

  if (wrongState) {
    return (
      <div className="space-y-4 text-center py-2">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-amber-500/10 text-amber-500 mx-auto">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">{copy.wrongStateMessage}</p>
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild variant="outline" className="w-full rounded-xl">
            <Link href={copy.wrongStateLinkHref}>{copy.wrongStateLinkLabel}</Link>
          </Button>
          <Button variant="ghost" className="w-full rounded-xl" onClick={() => setWrongState(false)}>
            Try a different code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="customerCode" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Customer Code</Label>
        <Input
          id="customerCode"
          placeholder="e.g. L0042"
          className="h-11"
          {...register('customerCode')}
        />
        {errors.customerCode && (
          <p className="text-[10px] font-bold text-destructive">{errors.customerCode.message}</p>
        )}
        <p className="text-xs text-muted-foreground">Printed on your invoice, receipt, or delivery slip.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phoneNumber" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Registered Phone Number</Label>
        <Input
          id="phoneNumber"
          placeholder="03001234567"
          className="h-11"
          {...register('phoneNumber')}
        />
        {errors.phoneNumber && (
          <p className="text-[10px] font-bold text-destructive">{errors.phoneNumber.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full h-11 font-bold rounded-xl" disabled={isPending}>
        {isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
        ) : (
          <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>
        )}
      </Button>
    </form>
  );
}

function PasswordStep({ mode, identity }: { mode: Mode; identity: VerifiedIdentity }) {
  const copy = COPY[mode];
  const { mutate: activate, isPending: isActivating } = useActivateAccount();
  const { mutate: resetPassword, isPending: isResetting } = useResetPasswordWithCode();
  const isPending = mode === 'activate' ? isActivating : isResetting;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivationPasswordInput>({
    resolver: zodResolver(activationPasswordSchema),
  });

  const onSubmit = (data: ActivationPasswordInput) => {
    const payload = {
      customerCode: identity.customerCode,
      phoneNumber: identity.phoneNumber,
      password: data.password,
    };
    const onError = (err: any) => {
      const message = err?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(message);
    };
    if (mode === 'activate') {
      activate(payload, { onError });
    } else {
      resetPassword(payload, { onError });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="p-3 rounded-xl bg-accent/30 border border-border/50 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
        <p className="text-sm font-medium">
          {copy.confirmationVerb} <span className="font-bold">{identity.customerName || 'your account'}</span>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-xs font-black uppercase tracking-widest text-muted-foreground">{copy.passwordLabel}</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Min. 8 characters, at least one number"
            className="h-11 pr-10"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && (
          <p className="text-[10px] font-bold text-destructive">{errors.password.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Confirm Password</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder="Repeat your password"
            className="h-11 pr-10"
            {...register('confirmPassword')}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.confirmPassword && (
          <p className="text-[10px] font-bold text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full h-11 font-bold rounded-xl" disabled={isPending}>
        {isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {copy.submittingLabel}</>
        ) : (
          <><KeyRound className="mr-2 h-4 w-4" /> {copy.submitLabel}</>
        )}
      </Button>
    </form>
  );
}

export function ActivationFlow({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const [identity, setIdentity] = useState<VerifiedIdentity | null>(null);

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-2">
          <Droplets className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">
          {identity ? copy.passwordSubtitle : copy.introSubtitle}
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-2xl">
        <CardContent className="p-6">
          {identity ? (
            <PasswordStep mode={mode} identity={identity} />
          ) : (
            <IdentityStep mode={mode} onVerified={setIdentity} />
          )}
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Remembered your password?{' '}
        <Link href="/auth/login" className="text-primary hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
