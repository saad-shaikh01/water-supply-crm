import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { impersonationApi } from '../api/impersonation.api';
import { apiErrorMessage } from '../../../lib/api-error';

export const impersonationKeys = {
  all: ['impersonation'] as const,
  list: (p: object) => ['impersonation', 'list', p] as const,
};

export const useImpersonationSessions = (params: { vendorId?: string; page?: number; limit?: number }) =>
  useQuery({
    queryKey: impersonationKeys.list(params),
    queryFn: () => impersonationApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useStartImpersonation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: impersonationApi.start,
    onSuccess: () => qc.invalidateQueries({ queryKey: impersonationKeys.all }),
  });
};

export const useRevokeImpersonation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: impersonationApi.revoke,
    onSuccess: () => {
      toast.success('Session revoked');
      void qc.invalidateQueries({ queryKey: impersonationKeys.all });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not revoke the session.')),
  });
};
