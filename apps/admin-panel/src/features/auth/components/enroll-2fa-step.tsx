'use client';

import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, CardContent, CardFooter, Input, Label } from '@water-supply-crm/ui';
import { totpCodeSchema, type TotpCodeInput } from '../schemas';
import { useEnrollTwoFactor } from '../hooks/use-auth';
import type { EnrollConfirmResponse } from '../api/auth.api';
import { RecoveryCodesPanel } from '../../security/components/recovery-codes-panel';
import { QrSetup } from '../../security/components/qr-setup';

interface Props {
  enrollmentToken: string;
  /** Called after the admin ticked "I saved them" and pressed Continue. */
  onDone: (data: EnrollConfirmResponse) => void;
  onBack: () => void;
}

/** Forced 2FA enrollment at login: QR -> confirm with a code -> recovery codes (once) -> continue. */
export function Enroll2faStep({ enrollmentToken, onDone, onBack }: Props) {
  const { start, confirm } = useEnrollTwoFactor();
  const started = useRef(false);
  const { register, handleSubmit, formState } = useForm<TotpCodeInput>({ resolver: zodResolver(totpCodeSchema) });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate(enrollmentToken);
  }, [enrollmentToken]);

  if (confirm.data) {
    const data = confirm.data;
    return (
      <CardContent>
        <RecoveryCodesPanel codes={data.recoveryCodes} onContinue={() => onDone(data)} />
      </CardContent>
    );
  }

  return (
    <form onSubmit={handleSubmit(({ code }) => confirm.mutate({ enrollmentToken, code }))} data-testid="enroll-2fa-step">
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Two-factor authentication is required for platform administrators. Scan the QR code with an authenticator app, then enter the
          code it shows.
        </p>
        {start.isPending && <p className="text-sm text-muted-foreground">Preparing...</p>}
        {start.data && <QrSetup setup={start.data} />}
        {start.isError && (
          <Button type="button" variant="outline" onClick={() => start.mutate(enrollmentToken)}>
            Retry
          </Button>
        )}
        <div className="space-y-2">
          <Label htmlFor="code">Authentication code</Label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" {...register('code')} />
          {formState.errors.code && <p className="text-sm text-destructive">{formState.errors.code.message}</p>}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <Button type="submit" className="w-full" disabled={confirm.isPending || !start.data}>
          {confirm.isPending ? 'Verifying...' : 'Confirm and enable'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </CardFooter>
    </form>
  );
}
