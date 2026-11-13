'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, CardContent, CardFooter, Input, Label } from '@water-supply-crm/ui';
import { recoveryCodeSchema, totpCodeSchema, type RecoveryCodeInput, type TotpCodeInput } from '../schemas';
import { useVerifyTwoFactor } from '../hooks/use-auth';
import type { VerifyTwoFactorResponse } from '../api/auth.api';

interface Props {
  challengeToken: string;
  onVerified: (data: VerifyTwoFactorResponse) => void;
  onBack: () => void;
}

/** Login step 2 for admins with 2FA: authenticator code, or a one-time recovery code. */
export function TwoFactorStep({ challengeToken, onVerified, onBack }: Props) {
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useVerifyTwoFactor();

  const totpForm = useForm<TotpCodeInput>({ resolver: zodResolver(totpCodeSchema) });
  const recoveryForm = useForm<RecoveryCodeInput>({ resolver: zodResolver(recoveryCodeSchema) });

  const submitTotp = ({ code }: TotpCodeInput) => verify.mutate({ challengeToken, code }, { onSuccess: onVerified });
  const submitRecovery = ({ recoveryCode }: RecoveryCodeInput) =>
    verify.mutate({ challengeToken, recoveryCode: recoveryCode.trim() }, { onSuccess: onVerified });

  return (
    <form
      onSubmit={useRecovery ? recoveryForm.handleSubmit(submitRecovery) : totpForm.handleSubmit(submitTotp)}
      data-testid="two-factor-step"
    >
      <CardContent className="space-y-4">
        {useRecovery ? (
          <div className="space-y-2">
            <Label htmlFor="recoveryCode">Recovery code</Label>
            <Input id="recoveryCode" autoComplete="off" autoFocus placeholder="XXXXX-XXXXX" {...recoveryForm.register('recoveryCode')} />
            {recoveryForm.formState.errors.recoveryCode && (
              <p className="text-sm text-destructive">{recoveryForm.formState.errors.recoveryCode.message}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="code">Authentication code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="123456"
              {...totpForm.register('code')}
            />
            {totpForm.formState.errors.code && <p className="text-sm text-destructive">{totpForm.formState.errors.code.message}</p>}
          </div>
        )}
        <button type="button" className="text-sm text-primary hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
        </button>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <Button type="submit" className="w-full" disabled={verify.isPending}>
          {verify.isPending ? 'Verifying...' : 'Verify'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </CardFooter>
    </form>
  );
}
