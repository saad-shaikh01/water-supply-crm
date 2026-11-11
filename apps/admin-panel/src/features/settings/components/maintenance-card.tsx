'use client';

import { useState } from 'react';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { SETTING_KEYS, type PlatformSettingsResponse } from '../api/settings.api';
import { settingValue, useUpdateSettings } from '../hooks/use-platform-settings';
import { SettingSwitch } from './setting-switch';

/** ISO string -> value for <input type="datetime-local"> (local time). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function MaintenanceCard({ data }: { data: PlatformSettingsResponse }) {
  const update = useUpdateSettings();
  const enabled = settingValue(data, SETTING_KEYS.maintenanceEnabled) === true;
  const serverMessage = (settingValue(data, SETTING_KEYS.maintenanceMessage) as string | null) ?? '';
  const serverEta = settingValue(data, SETTING_KEYS.maintenanceEta) as string | null;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(serverMessage);
  const [eta, setEta] = useState(isoToLocalInput(serverEta));
  const tooLong = message.length > 500;

  const openConfirm = () => {
    setMessage(serverMessage);
    setEta(isoToLocalInput(serverEta));
    setOpen(true);
  };

  const patch = () => ({
    [SETTING_KEYS.maintenanceEnabled]: true,
    [SETTING_KEYS.maintenanceMessage]: message.trim(),
    [SETTING_KEYS.maintenanceEta]: localInputToIso(eta),
  });

  return (
    <Card data-testid="maintenance-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Maintenance mode</CardTitle>
          <Badge variant={enabled ? 'warning' : 'secondary'}>{enabled ? 'ON' : 'OFF'}</Badge>
        </div>
        <CardDescription>
          While ON, everyone except platform administrators gets a maintenance notice (503). Health checks, sign-in and webhooks keep working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <SettingSwitch
            id="maintenance-toggle"
            label="Maintenance mode"
            checked={enabled}
            disabled={update.isPending}
            onChange={(next) => (next ? openConfirm() : update.mutate({ [SETTING_KEYS.maintenanceEnabled]: false }))}
          />
          <Label htmlFor="maintenance-toggle">{enabled ? 'Maintenance is active' : 'Maintenance is off'}</Label>
        </div>

        {enabled && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm">
              <span className="text-muted-foreground">Message: </span>
              {serverMessage || <em className="text-muted-foreground">default notice</em>}
            </p>
            {serverEta && (
              <p className="text-sm">
                <span className="text-muted-foreground">Expected back: </span>
                {new Date(serverEta).toLocaleString()}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={openConfirm}>
              Edit notice
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !update.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{enabled ? 'Update maintenance notice' : 'Turn maintenance mode ON?'}</DialogTitle>
            <DialogDescription>
              Vendors, staff, drivers and customers will see this notice and be unable to use the platform until you turn it off.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-message">Message</Label>
            <Textarea
              id="maintenance-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="We are upgrading the platform and will be back shortly."
            />
            {tooLong && <p className="text-sm text-destructive">Message must be at most 500 characters</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-eta">Expected back (optional)</Label>
            <Input id="maintenance-eta" type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={update.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={tooLong || update.isPending} onClick={() => update.mutate(patch(), { onSuccess: () => setOpen(false) })}>
              {update.isPending ? 'Saving...' : enabled ? 'Save notice' : 'Turn maintenance ON'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
