'use client';

import { useEffect } from 'react';
import { clearAuthCookies, clearImpersonationMarker } from '../../../../features/impersonation/session';

export default function SupportSessionEndedPage() {
  useEffect(() => {
    clearAuthCookies();
    clearImpersonationMarker();
    try {
      window.localStorage.removeItem('vendor-auth-store');
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <div className="rounded-lg border bg-card p-6 text-center" data-testid="impersonation-ended">
      <p className="font-semibold">Support session ended</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This support session has ended. You can close this tab and return to the admin panel.
      </p>
    </div>
  );
}
