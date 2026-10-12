import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { vendorsApi, vendorWipeApi, type VendorQuery, type WipeInput } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVendors = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));

  const params = { page, limit };

  return {
    ...useQuery({
      queryKey: queryKeys.vendors.all(params),
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor deleted');
    },
    onError: () => toast.error('Failed to delete vendor'),
  });
};

/** Readable message from a Nest error response (`{ message: string | string[] }`). */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : (m ?? fallback);
}

export const useWipePreview = (vendorId: string | null, enabled: boolean) => {
  const query = useQuery({
    queryKey: ['vendors', 'wipe-preview', vendorId],
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
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
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success(res.message);
    },
  });
  return { ...mutation, errorMessage: mutation.error ? apiErrorMessage(mutation.error, 'The wipe failed. Nothing was changed.') : null };
};
