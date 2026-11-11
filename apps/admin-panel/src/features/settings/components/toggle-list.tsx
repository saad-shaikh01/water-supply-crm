'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@water-supply-crm/ui';
import type { PlatformSettingEntry } from '../api/settings.api';
import { useUpdateSettings } from '../hooks/use-platform-settings';
import { SettingSwitch } from './setting-switch';

interface Props {
  title: string;
  description: string;
  entries: PlatformSettingEntry[];
  emptyText: string;
  /** Optional per-key label override (default: the registry description). */
  labels?: Record<string, string>;
}

/** Boolean registry settings rendered as optimistic toggles (rolled back by the hook on failure). */
export function ToggleList({ title, description, entries, emptyText, labels }: Props) {
  const update = useUpdateSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
        {entries.map((e) => (
          <div key={e.key} className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{labels?.[e.key] ?? e.key}</p>
              <p className="text-xs text-muted-foreground">{e.description}</p>
              <p className="font-mono text-xs text-muted-foreground">{e.key}</p>
            </div>
            <SettingSwitch
              id={`toggle-${e.key}`}
              label={labels?.[e.key] ?? e.key}
              checked={e.value === true}
              disabled={update.isPending}
              onChange={(next) => update.mutate({ [e.key]: next })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
