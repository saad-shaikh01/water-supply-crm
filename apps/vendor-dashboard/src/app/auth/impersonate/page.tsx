'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { impersonationApi } from '../../../features/impersonation/api/impersonation.api';
import { clearAuthCookies, startImpersonationCookies } from '../../../features/impersonation/session';
import { useAuthStore, type UserRole } from '../../../store/auth.store';

function Exchange() {
  const params = useSearchParams();
  const code = params.get('code');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke would burn the single-use code
    ran.current = true;
    if (!code) {
      setError('Missing handoff code.');
      return;
    }
    // Strip the one-time code from the URL immediately.
    window.history.replaceState(null, '', '/auth/impersonate');
    // A stale token must not be attached to the (public) exchange call.
    clearAuthCookies();
    useAuthStore.getState().clearUser(); // drop any previous vendor user
    impersonationApi
      .exchange(code)
      .then(({ data }) => {
        startImpersonationCookies(data.access_token, data.user.role);
        // Persisted store (rehydrated by the dashboard): without it the banner/header show no vendor user name.
        useAuthStore.getState().setUser({ ...data.user, role: data.user.role as UserRole });
        window.location.replace('/dashboard/overview');
      })
      .catch(() => setError('This support link is invalid, expired or has already been used.'));
  }, [code]);

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center" role="alert">
        <p className="font-semibold">Could not start support session</p>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  return <p className="text-center text-sm text-muted-foreground">Starting support session...</p>;
}

export default function ImpersonateExchangePage() {
  return (
    <Suspense fallback={null}>
      <Exchange />
    </Suspense>
  );
}
