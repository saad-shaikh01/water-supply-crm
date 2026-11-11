'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { SETTING_KEYS } from '../api/settings.api';
import { settingValue, usePlatformSettings } from '../hooks/use-platform-settings';

/** Amber strip above the header while maintenance mode is ON (admins keep working; everyone else sees a 503). */
export function MaintenanceBanner() {
  const { data } = usePlatformSettings({ refetchInterval: 60_000 });
  if (settingValue(data, SETTING_KEYS.maintenanceEnabled) !== true) return null;

  const eta = settingValue(data, SETTING_KEYS.maintenanceEta) as string | null;
  return (
    <div
      role="status"
      data-testid="maintenance-banner"
      className="flex items-center gap-2 bg-amber-500 px-6 py-2 text-sm font-medium text-black"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Maintenance mode is ON. Only platform administrators can use the platform.
        {eta ? ` Expected back ${new Date(eta).toLocaleString()}.` : ''}
      </span>
      <Link href="/settings" className="ml-auto underline">
        Manage
      </Link>
    </div>
  );
}
