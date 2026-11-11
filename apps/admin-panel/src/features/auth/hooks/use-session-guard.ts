'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { authApi } from '../api/auth.api';
import { queryKeys } from '../../../lib/query-keys';
import { clearSession } from '../../../lib/clear-session';
import { useAuthStore } from '../../../store/auth.store';

export type SessionStatus = 'loading' | 'ok' | 'denied' | 'error';

/** Validates the session once via GET /auth/me and enforces SUPER_ADMIN. */
export function useSessionGuard(): { status: SessionStatus; error: unknown; retry: () => void } {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: authApi.me,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const httpStatus = (error as { response?: { status?: number } } | null)?.response?.status;
  const forbidden = !!data && data.role !== 'SUPER_ADMIN';
  // Only 401/403 are auth failures; network/5xx errors must not log the user out.
  const authFailed = httpStatus === 401 || httpStatus === 403;
  const denied = forbidden || authFailed;

  useEffect(() => {
    if (data && !forbidden) {
      setUser({ id: data.id, name: data.name, email: data.email, role: data.role });
    }
  }, [data, forbidden, setUser]);

  useEffect(() => {
    if (!denied) return;
    clearSession();
    router.replace(`/auth/login?reason=${forbidden || httpStatus === 403 ? 'forbidden' : 'expired'}`);
  }, [denied, forbidden, httpStatus, router]);

  const retry = () => {
    void refetch();
  };

  if (isLoading) return { status: 'loading', error: null, retry };
  if (denied) return { status: 'denied', error, retry };
  if (error) return { status: 'error', error, retry };
  return { status: 'ok', error: null, retry };
}
