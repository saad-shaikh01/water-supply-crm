'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { impersonationApi } from '../../features/impersonation/api/impersonation.api';
import { useImpersonation } from '../../features/impersonation/hooks/use-impersonation';
import { clearAuthCookies, formatRemaining, navigateTo } from '../../features/impersonation/session';
import { useAuthStore } from '../../store/auth.store';

const END_PATH = '/auth/impersonate/ended';

/**
 * Persistent, non-dismissible support-session banner. Rendered by the dashboard layout; shows
 * nothing for ordinary sessions. Survives reloads because the details come from `/auth/me`.
 */
export function ImpersonationBanner() {
  const { active, info } = useImpersonation();
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [exiting, setExiting] = useState(false);

  const expiresAtMs = info?.expiresAt ? new Date(info.expiresAt).getTime() : null;
  const remaining = expiresAtMs == null ? null : expiresAtMs - now;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const finish = () => {
    clearAuthCookies();
    clearUser();
    queryClient.clear();
    navigateTo(END_PATH);
  };

  useEffect(() => {
    if (active && remaining != null && remaining <= 0) finish();
  }, [active, remaining]);

  if (!active) return null;

  const exit = async () => {
    setExiting(true);
    try {
      await impersonationApi.exit();
    } catch {
      // Session may already be gone (expired / revoked); either way we leave.
    }
    finish();
  };

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className="sticky top-0 z-[100] flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-500 px-4 py-2 text-sm font-semibold text-black shadow-md"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Support session: viewing as {user?.name ?? 'vendor admin'}
        {info ? ` by ${info.actorName} - ${info.mode === 'SUPPORT' ? 'Support (read/write)' : 'Read-only'}` : ''}
        {remaining != null ? ` - expires in ${formatRemaining(remaining)}` : ''}
      </span>
      <span className="text-xs font-normal">Use a separate browser profile; this replaces any vendor login in this browser.</span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="rounded-md bg-black px-3 py-1 text-xs font-bold text-amber-400 hover:bg-black/80 disabled:opacity-60"
      >
        {exiting ? 'Exiting...' : 'Exit'}
      </button>
    </div>
  );
}
