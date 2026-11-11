'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { whatsappApi, type WhatsAppQuery } from '../api/whatsapp.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

export const useWhatsAppAccounts = (params: WhatsAppQuery) =>
  useQuery({
    queryKey: queryKeys.whatsappAccounts.list(params),
    queryFn: () => whatsappApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useAssignableVendors = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.whatsappAccounts.assignable(q),
    queryFn: () => whatsappApi.assignable(q),
    enabled,
    gcTime: 0,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.whatsappAccounts.all });
}

/** 409 VENDOR_HAS_ACCOUNT is surfaced to the caller (replace confirmation), not toasted. */
export function useAssignVendor(onConflict?: (vars: { id: string; vendorId: string }) => void) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; vendorId: string; replace?: boolean }) => whatsappApi.assign(v.id, v.vendorId, v.replace),
    onSuccess: () => {
      invalidate();
      toast.success('Vendor assigned to WhatsApp account');
    },
    onError: (e, v) => {
      const r = (e as { response?: { status?: number; data?: { code?: string } } })?.response;
      if (r?.status === 409 && r.data?.code === 'VENDOR_HAS_ACCOUNT' && onConflict) return onConflict({ id: v.id, vendorId: v.vendorId });
      toast.error(apiErrorMessage(e, 'Failed to assign vendor'));
    },
  });
}

export function useUnassignVendor() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; vendorId: string }) => whatsappApi.unassign(v.id, v.vendorId),
    onSuccess: () => {
      invalidate();
      toast.success('Vendor unassigned. The account was not deleted.');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to unassign vendor')),
  });
}

export function useVerifyAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => whatsappApi.verify(id),
    onSuccess: (acc) => {
      invalidate();
      if (acc.status === 'READY') toast.success('Account verified');
      else toast.warning(`Verification finished: ${acc.status.replace(/_/g, ' ').toLowerCase()}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Verification failed')),
  });
}
