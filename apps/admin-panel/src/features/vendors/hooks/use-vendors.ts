import { useQuery, useMutation, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { vendorsApi, vendorWipeApi, type WipeInput } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import type { CreateVendorInputBody, SortOrder, VendorSort, VendorStatusFilter } from '../types';

// Re-exported for backward compatibility; the implementation lives in lib/api-error.
export { apiErrorMessage };

/** Vendor changes also change the platform dashboard counters. */
export const invalidateVendorData = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
};

const STATUSES: VendorStatusFilter[] = ['all', 'active', 'suspended', 'live', 'not_live'];
const SORTS: VendorSort[] = ['createdAt', 'name', 'customers'];

/** List state lives in the URL (nuqs): ?q=&status=&sort=&order=&page=&limit= . Any filter change resets to page 1. */
export const useVendors = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [statusRaw, setStatusRaw] = useQueryState('status', parseAsString.withDefault('all'));
  const [sortRaw, setSortRaw] = useQueryState('sort', parseAsString.withDefault('createdAt'));
  const [orderRaw, setOrderRaw] = useQueryState('order', parseAsString.withDefault('desc'));

  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as VendorStatusFilter) : 'all';
  const sort = (SORTS as string[]).includes(sortRaw) ? (sortRaw as VendorSort) : 'createdAt';
  const order: SortOrder = orderRaw === 'asc' ? 'asc' : 'desc';

  const params = { page, limit, search: q, status, sort, order };

  return {
    ...useQuery({
      queryKey: queryKeys.vendors.list(params),
      queryFn: () => vendorsApi.getAll(params),
      placeholderData: keepPreviousData,
    }),
    page,
    setPage,
    limit,
    setLimit: (n: number) => {
      void setLimit(n);
      void setPage(1);
    },
    search: q,
    setSearch: (v: string) => {
      void setQ(v.trim() ? v : null);
      void setPage(1);
    },
    status,
    setStatus: (v: VendorStatusFilter) => {
      void setStatusRaw(v === 'all' ? null : v);
      void setPage(1);
    },
    sort,
    order,
    /** Clicking the active column flips the order; a new column starts ascending (createdAt starts descending). */
    toggleSort: (col: VendorSort) => {
      if (col === sort) void setOrderRaw(order === 'asc' ? 'desc' : 'asc');
      else {
        void setSortRaw(col);
        void setOrderRaw(col === 'createdAt' ? 'desc' : 'asc');
      }
      void setPage(1);
    },
    clearFilters: () => {
      void setQ(null);
      void setStatusRaw(null);
      void setSortRaw(null);
      void setOrderRaw(null);
      void setPage(1);
    },
    hasFilters: q.trim() !== '' || status !== 'all',
  };
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
