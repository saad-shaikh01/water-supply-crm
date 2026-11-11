'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { platformAdminsApi, type CreatePlatformAdminInput, type PlatformAdminQuery } from '../api/platform-admins.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

export const usePlatformAdmins = (params: PlatformAdminQuery) =>
  useQuery({
    queryKey: queryKeys.platformAdmins.list(params),
    queryFn: () => platformAdminsApi.list(params),
    placeholderData: keepPreviousData,
  });

/** All admin mutations; each invalidates the list and toasts failures with the server message. */
export const usePlatformAdminActions = () => {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.platformAdmins.all });
  const fail = (fallback: string) => (e: unknown) => toast.error(apiErrorMessage(e, fallback));

  return {
    create: useMutation({
      mutationFn: (body: CreatePlatformAdminInput) => platformAdminsApi.create(body),
      onSuccess: refresh,
      onError: fail('Could not create the administrator.'),
    }),
    deactivate: useMutation({
      mutationFn: (v: { id: string; reason: string }) => platformAdminsApi.deactivate(v.id, v.reason),
      onSuccess: () => {
        toast.success('Administrator deactivated');
        refresh();
      },
      onError: fail('Could not deactivate the administrator.'),
    }),
    activate: useMutation({
      mutationFn: (id: string) => platformAdminsApi.activate(id),
      onSuccess: () => {
        toast.success('Administrator reactivated');
        refresh();
      },
      onError: fail('Could not reactivate the administrator.'),
    }),
    resetPassword: useMutation({
      mutationFn: (v: { id: string; mode: 'EMAIL' | 'TEMP' }) => platformAdminsApi.resetPassword(v.id, v.mode),
      onSuccess: (r, v) => {
        if (v.mode === 'EMAIL') toast.success('Password reset email sent');
        refresh();
      },
      onError: fail('Could not reset the password.'),
    }),
    resetTwoFactor: useMutation({
      mutationFn: (v: { id: string; reason: string }) => platformAdminsApi.resetTwoFactor(v.id, v.reason),
      onSuccess: () => {
        toast.success('Two-factor authentication reset');
        refresh();
      },
      onError: fail('Could not reset two-factor authentication.'),
    }),
    unlock: useMutation({
      mutationFn: (id: string) => platformAdminsApi.unlock(id),
      onSuccess: () => toast.success('Account unlocked'),
      onError: fail('Could not unlock the account.'),
    }),
  };
};
