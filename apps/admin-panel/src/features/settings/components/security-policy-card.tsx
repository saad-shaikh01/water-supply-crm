'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@water-supply-crm/ui';
import { SETTING_KEYS, type PlatformSettingsResponse } from '../api/settings.api';
import { settingValue, useUpdateSettings } from '../hooks/use-platform-settings';
import { SettingSwitch } from './setting-switch';

interface Draft {
  require2fa: boolean;
  maxAttempts: string;
  lockMinutes: string;
}

const RANGES = {
  maxAttempts: { min: 3, max: 20, label: 'Failed attempts before lock' },
  lockMinutes: { min: 1, max: 1440, label: 'Lock duration (minutes)' },
} as const;

export function validateInt(value: string, min: number, max: number): string | null {
  if (!/^\d+$/.test(value.trim())) return `Enter a whole number between ${min} and ${max}`;
  const n = Number(value);
  return n >= min && n <= max ? null : `Enter a whole number between ${min} and ${max}`;
}

function fromServer(data: PlatformSettingsResponse): Draft {
  return {
    require2fa: settingValue(data, SETTING_KEYS.require2fa) === true,
    maxAttempts: String(settingValue(data, SETTING_KEYS.loginMaxAttempts) ?? 5),
    lockMinutes: String(settingValue(data, SETTING_KEYS.loginLockMinutes) ?? 15),
  };
}

/** Security policy: edited as a draft with a save bar that appears only when something changed. */
export function SecurityPolicyCard({ data }: { data: PlatformSettingsResponse }) {
  const update = useUpdateSettings();
  const server = fromServer(data);
  const [draft, setDraft] = useState<Draft>(server);
  const serverKey = JSON.stringify(server);
  // Re-sync when the server value changes (after save, or edits from another tab).
  useEffect(() => setDraft(server), [serverKey]);

  const dirty = JSON.stringify(draft) !== serverKey;
  const maxErr = validateInt(draft.maxAttempts, RANGES.maxAttempts.min, RANGES.maxAttempts.max);
  const lockErr = validateInt(draft.lockMinutes, RANGES.lockMinutes.min, RANGES.lockMinutes.max);

  const save = () =>
    update.mutate({
      [SETTING_KEYS.require2fa]: draft.require2fa,
      [SETTING_KEYS.loginMaxAttempts]: Number(draft.maxAttempts),
      [SETTING_KEYS.loginLockMinutes]: Number(draft.lockMinutes),
    });

  return (
    <Card data-testid="security-policy-card">
      <CardHeader>
        <CardTitle>Security policy</CardTitle>
        <CardDescription>Sign-in protection for platform administrators.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="require-2fa">Require two-factor authentication</Label>
            <p className="text-xs text-muted-foreground">
              Administrators without 2FA are forced to enroll at their next sign-in. Make sure everyone is ready before enabling.
            </p>
          </div>
          <SettingSwitch id="require-2fa" label="Require two-factor authentication" checked={draft.require2fa} onChange={(v) => setDraft({ ...draft, require2fa: v })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="login-max-attempts">{RANGES.maxAttempts.label}</Label>
            <Input id="login-max-attempts" inputMode="numeric" value={draft.maxAttempts} onChange={(e) => setDraft({ ...draft, maxAttempts: e.target.value })} />
            {maxErr && <p className="text-sm text-destructive">{maxErr}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-lock-minutes">{RANGES.lockMinutes.label}</Label>
            <Input id="login-lock-minutes" inputMode="numeric" value={draft.lockMinutes} onChange={(e) => setDraft({ ...draft, lockMinutes: e.target.value })} />
            {lockErr && <p className="text-sm text-destructive">{lockErr}</p>}
          </div>
        </div>
        {dirty && (
          <div role="region" aria-label="Unsaved changes" className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2" data-testid="save-bar">
            <span className="text-sm">You have unsaved changes</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => setDraft(server)}>
                Discard
              </Button>
              <Button size="sm" disabled={!!maxErr || !!lockErr || update.isPending} onClick={save}>
                {update.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
