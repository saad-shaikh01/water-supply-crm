'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { securityApi } from '../api/security.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import { useLogout } from '../../auth/hooks/use-auth';

export const useTwoFactorStatus = () =>
  useQuery({ queryKey: queryKeys.security.twoFactor, queryFn: securityApi.twoFactorStatus });

export const useTwoFactorActions = () => {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.security.all });
  const fail = (fallback: string) => (e: unknown) => toast.error(apiErrorMessage(e, fallback));

  return {
    setup: useMutation({ mutationFn: () => securityApi.setup(), onError: fail('Could not start two-factor setup.') }),
    confirm: useMutation({
      mutationFn: (code: string) => securityApi.confirm(code),
      onSuccess: () => {
        refresh();
      },
      onError: fail('Invalid verification code.'),
    }),
    regenerate: useMutation({
      mutationFn: (code: string) => securityApi.regenerate(code),
      onSuccess: () => {
        refresh();
      },
      onError: fail('Could not regenerate recovery codes.'),
    }),
    disable: useMutation({
      mutationFn: (v: { password: string; code: string }) => securityApi.disable(v.password, v.code),
      onSuccess: () => {
        toast.success('Two-factor authentication disabled');
        refresh();
      },
      onError: fail('Could not disable two-factor authentication.'),
    }),
  };
};

export const useAdminSessions = () => useQuery({ queryKey: queryKeys.security.sessions, queryFn: securityApi.sessions });

export const useSessionActions = () => {
  const qc = useQueryClient();
  const logout = useLogout();
  const refetch = () => qc.invalidateQueries({ queryKey: queryKeys.security.sessions });

  return {
    /** Revoking the CURRENT session signs this browser out. */
    revoke: useMutation({
      mutationFn: (v: { id: string; current: boolean }) => securityApi.revokeSession(v.id),
      onSuccess: (_d, v) => {
        toast.success('Session revoked');
        if (v.current) logout();
        else refetch();
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'Could not revoke the session.')),
    }),
    revokeOthers: useMutation({
      mutationFn: () => securityApi.revokeOthers(),
      onSuccess: (r) => {
        toast.success(`Revoked ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`);
        refetch();
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'Could not revoke sessions.')),
    }),
  };
};
