import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vendorsApi, vendorWipeApi, type WipeInput } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import type { CreateVendorInputBody } from '../types';

// Re-exported for backward compatibility; the implementation lives in lib/api-error.
export { apiErrorMessage };

/** Vendor changes also change the platform dashboard counters. */
export const invalidateVendorData = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
};

export const useCreateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateVendorInputBody) => vendorsApi.create(data),
    onSuccess: () => {
      invalidateVendorData(queryClient);
    },
  });
};

export const useUpdateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => vendorsApi.update(id, data),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor updated successfully');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to update vendor')),
  });
};

export const useDeleteVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vendorsApi.remove(id),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor deleted');
    },
  });
};

export const useWipePreview = (vendorId: string | null, enabled: boolean) => {
  const query = useQuery({
    queryKey: queryKeys.vendors.wipePreview(vendorId ?? ''),
    queryFn: () => vendorWipeApi.preview(vendorId as string),
    enabled: enabled && !!vendorId,
    gcTime: 0, // never show a stale count for a destructive action
    staleTime: 0,
  });
  return { ...query, errorMessage: query.error ? apiErrorMessage(query.error, 'Unknown error') : null };
};

export const useSuspendVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: string | { id: string; reason?: string }) =>
      typeof v === 'string' ? vendorsApi.suspend(v) : vendorsApi.suspend(v.id, v.reason),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor suspended');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to suspend vendor')),
  });
};

export const useUnsuspendVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vendorsApi.unsuspend(id),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor reactivated');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to reactivate vendor')),
  });
};

export const useBulkVendorAction = (action: 'suspend' | 'unsuspend') => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason?: string }) =>
      action === 'suspend' ? vendorsApi.bulkSuspend(ids, reason) : vendorsApi.bulkUnsuspend(ids, reason),
    onSettled: () => invalidateVendorData(queryClient),
  });
};

export const useWipeVendor = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: WipeInput) => vendorWipeApi.wipe(input),
    onSuccess: (res) => {
      invalidateVendorData(queryClient);
      toast.success(res.message);
    },
  });
  return { ...mutation, errorMessage: mutation.error ? apiErrorMessage(mutation.error, 'The wipe failed. Nothing was changed.') : null };
};
