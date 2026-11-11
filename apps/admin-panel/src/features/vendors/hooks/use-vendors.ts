import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { vendorsApi, vendorWipeApi, type WipeInput } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

// Re-exported for backward compatibility; the implementation lives in lib/api-error.
export { apiErrorMessage };

/** Vendor changes also change the platform dashboard counters. */
const invalidateVendorData = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
};

export const useVendors = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));

  const params = { page, limit };

  return {
    ...useQuery({
      queryKey: queryKeys.vendors.list(params),
      queryFn: () => vendorsApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
  };
};

export const useCreateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => vendorsApi.create(data),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor created successfully');
    },
    onError: () => toast.error('Failed to create vendor'),
  });
};

export const useUpdateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      vendorsApi.update(id, data),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor updated successfully');
    },
    onError: () => toast.error('Failed to update vendor'),
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
    onError: () => toast.error('Failed to delete vendor'),
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
    mutationFn: (id: string) => vendorWipeApi.suspend(id),
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
    mutationFn: (id: string) => vendorWipeApi.unsuspend(id),
    onSuccess: () => {
      invalidateVendorData(queryClient);
      toast.success('Vendor reactivated');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to reactivate vendor')),
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
