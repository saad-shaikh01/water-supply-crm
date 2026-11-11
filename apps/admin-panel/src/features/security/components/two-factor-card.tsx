'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@water-supply-crm/ui';
import { ErrorState } from '../../../components/shared/error-state';
import { useTwoFactorActions, useTwoFactorStatus } from '../hooks/use-security';
import { QrSetup } from './qr-setup';
import { RecoveryCodesPanel } from './recovery-codes-panel';

const CODE_RE = /^\d{6}$/;
type Mode = null | 'enable' | 'regenerate' | 'disable';

export function TwoFactorCard() {
  const status = useTwoFactorStatus();
  const actions = useTwoFactorActions();
  const [mode, setMode] = useState<Mode>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const close = () => {
    setMode(null);
    setCode('');
    setPassword('');
    setCodes(null);
    actions.setup.reset();
  };

  // Starting enrollment creates the pending secret + QR as soon as the dialog opens.
  useEffect(() => {
    if (mode === 'enable' && !actions.setup.data && !actions.setup.isPending) actions.setup.mutate();
  }, [mode]);

  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const enabled = status.data?.enabled ?? false;
  const codeValid = CODE_RE.test(code);

  const submit = () => {
    if (mode === 'enable') actions.confirm.mutate(code, { onSuccess: (r) => setCodes(r.recoveryCodes) });
    if (mode === 'regenerate') actions.regenerate.mutate(code, { onSuccess: (r) => setCodes(r.recoveryCodes) });
    if (mode === 'disable') actions.disable.mutate({ password, code }, { onSuccess: close });
  };
  const pending = actions.confirm.isPending || actions.regenerate.isPending || actions.disable.isPending;
  const title = mode === 'enable' ? 'Enable two-factor authentication' : mode === 'regenerate' ? 'Regenerate recovery codes' : 'Disable two-factor authentication';

  return (
    <Card data-testid="two-factor-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Two-factor authentication</CardTitle>
          {status.data && (
            <Badge variant={enabled ? 'default' : 'secondary'} data-testid="two-factor-status">
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
        </div>
        <CardDescription>
          Protect your account with a time-based code from an authenticator app.
          {enabled && status.data ? ` ${status.data.recoveryCodesRemaining} recovery code(s) remaining.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {status.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : enabled ? (
          <>
            <Button variant="outline" onClick={() => setMode('regenerate')}>
              Regenerate recovery codes
            </Button>
            <Button variant="destructive" onClick={() => setMode('disable')}>
              Disable
            </Button>
          </>
        ) : (
          <Button onClick={() => setMode('enable')}>Enable two-factor authentication</Button>
        )}
      </CardContent>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && close()}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{codes ? 'Recovery codes' : title}</DialogTitle>
          </DialogHeader>
          {codes ? (
            <RecoveryCodesPanel codes={codes} continueLabel="Done" onContinue={close} />
          ) : (
            <>
              {mode === 'enable' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Scan the QR code with your authenticator app, then enter the 6-digit code.</p>
                  {actions.setup.isPending && <p className="text-sm text-muted-foreground">Preparing...</p>}
                  {actions.setup.data && <QrSetup setup={actions.setup.data} />}
                </div>
              )}
              {mode === 'regenerate' && (
                <p className="text-sm text-muted-foreground">Old recovery codes stop working. Enter a current code from your authenticator app.</p>
              )}
              {mode === 'disable' && (
                <div className="space-y-1.5">
                  <Label htmlFor="disable-password">Password</Label>
                  <Input id="disable-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="security-code">Authentication code</Label>
                <Input
                  id="security-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {code && !codeValid && <p className="text-sm text-destructive">Enter the 6-digit code</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button
                  variant={mode === 'disable' ? 'destructive' : 'default'}
                  disabled={!codeValid || pending || (mode === 'disable' && !password) || (mode === 'enable' && !actions.setup.data)}
                  onClick={submit}
                >
                  {pending ? 'Please wait...' : mode === 'enable' ? 'Confirm and enable' : mode === 'regenerate' ? 'Regenerate' : 'Disable'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
