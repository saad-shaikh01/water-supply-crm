import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString, parseAsFloat } from 'nuqs';
import { toast } from 'sonner';
import type { CustomerDetail, CustomerConsumption, CustomerScheduleItem, PaymentTypeValue } from '@water-supply-crm/types';
import { customersApi } from '../api/customers.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCustomers = () => {
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [routeId] = useQueryState('routeId', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [dayOfWeek] = useQueryState('dayOfWeek', parseAsInteger.withDefault(0));
  const [paymentType] = useQueryState('paymentType', parseAsString.withDefault(''));
  const [isActive, setIsActive] = useQueryState('isActive', parseAsString.withDefault('true'));
  const [balanceMin] = useQueryState('balanceMin', parseAsFloat.withDefault(NaN));
  const [balanceMax] = useQueryState('balanceMax', parseAsFloat.withDefault(NaN));
  const [sort, setSort] = useQueryState('sort', parseAsString.withDefault(''));
  const [sortDir, setSortDir] = useQueryState('sortDir', parseAsString.withDefault(''));

  const params = {
    search: search || undefined,
    page,
    limit,
    routeId: routeId || undefined,
    vanId: vanId || undefined,
    dayOfWeek: dayOfWeek || undefined,
    paymentType: (['MONTHLY', 'CASH'] as const).includes(paymentType as PaymentTypeValue)
      ? (paymentType as PaymentTypeValue)
      : undefined,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    balanceMin: !isNaN(balanceMin) ? balanceMin : undefined,
    balanceMax: !isNaN(balanceMax) ? balanceMax : undefined,
    sort: sort || undefined,
    sortDir: (sortDir as 'asc' | 'desc') || undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.customers.all(params),
      queryFn: () => customersApi.getAll(params).then((r) => r.data),
    }),
    search,
    page,
    setPage,
    limit,
    setLimit,
    routeId,
    vanId,
    dayOfWeek,
    paymentType,
    isActive,
    setIsActive,
    balanceMin,
    balanceMax,
    sort,
    setSort,
    sortDir,
    setSortDir,
  };
};

export const useAllCustomers = () => {
  return useQuery({
    queryKey: ['customers', 'all'],
    queryFn: async () => {
      const first = await customersApi.getAll({ limit: 100, page: 1 }).then((r) => r.data);
      // paginate() nests pagination info under `meta` — totalPages is NOT top-level
      const totalPages: number = (first as any).meta?.totalPages ?? (first as any).totalPages ?? 1;
      if (totalPages <= 1) return first;
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          customersApi.getAll({ limit: 100, page: i + 2 }).then((r) => (r.data as any).data)
        )
      );
      return { ...(first as any), data: [...(first as any).data, ...rest.flat()] };
    },
  });
};

/**
 * Server-side customer search for comboboxes — searches name, customerCode and
 * phoneNumber on the backend. Debounce the input before passing it here.
 */
export const useCustomerSearch = (search: string, enabled = true) => {
  return useQuery({
    queryKey: ['customers', 'combobox-search', search],
    queryFn: () =>
      customersApi
        .getAll({ search: search || undefined, isActive: true, limit: 20, page: 1 })
        .then((r) => r.data),
    enabled,
    placeholderData: (prev) => prev,
  });
};

export const useCustomer = (id: string) => {
  return useQuery({
    queryKey: queryKeys.customers.one(id),
    queryFn: (): Promise<CustomerDetail> => customersApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer created successfully');
    },
    onError: () => toast.error('Failed to create customer'),
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      customersApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(id) });
      toast.success('Customer updated successfully');
    },
    onError: () => toast.error('Failed to update customer'),
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
    onError: () => toast.error('Failed to delete customer'),
  });
};

export const useDeactivateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deactivated');
    },
    onError: () => toast.error('Failed to deactivate customer'),
  });
};

export const useReactivateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer reactivated');
    },
    onError: () => toast.error('Failed to reactivate customer'),
  });
};

export const useCreatePortalAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      customersApi.createPortalAccount(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(id) });
      toast.success('Portal account created successfully');
    },
    onError: () => toast.error('Failed to create portal account'),
  });
};

export const useRemovePortalAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customersApi.removePortalAccount(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(id) });
      toast.success('Portal access revoked');
    },
    onError: () => toast.error('Failed to revoke portal access'),
  });
};

export const useCustomerConsumption = (
  id: string,
  params: { from?: string; to?: string; allTime?: boolean },
) => {
  const resolvedParams: Record<string, string> = params.allTime
    ? { allTime: 'true' }
    : {
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
      };
  return useQuery({
    queryKey: ['customers', id, 'consumption', resolvedParams],
    queryFn: (): Promise<CustomerConsumption> =>
      customersApi.getConsumption(id, resolvedParams).then((r) => r.data),
    enabled: !!id,
  });
};

export const useCustomerSchedule = (id: string, params?: { dateFrom?: string; dateTo?: string }) =>
  useQuery({
    queryKey: ['customers', id, 'schedule', params?.dateFrom, params?.dateTo],
    queryFn: (): Promise<CustomerScheduleItem[]> =>
      customersApi.getSchedule(id, params).then((r) => r.data),
    enabled: !!id && !!params?.dateFrom,
  });

export const useSetCustomPrice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) =>
      customersApi.setCustomPrice(customerId, data),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Custom price saved');
    },
    onError: () => toast.error('Failed to save custom price'),
  });
};

export const useRemoveCustomPrice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, productId }: { customerId: string; productId: string }) =>
      customersApi.removeCustomPrice(customerId, productId),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Custom price removed');
    },
    onError: () => toast.error('Failed to remove custom price'),
  });
};

export interface BulkScheduleUpdateResult {
  requestedCount: number;
  updatedCount: number;
  skippedCount: number;
  skipped: Array<{ customerId: string; name: string; reason: string }>;
}

export const useBulkUpdateSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerIds: string[]; vanId?: string; dayOfWeek?: number }): Promise<BulkScheduleUpdateResult> =>
      customersApi.bulkUpdateSchedule(data).then((r) => r.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (result.skippedCount > 0) {
        toast.warning(
          `Updated ${result.updatedCount} of ${result.requestedCount} customer(s) — ${result.skippedCount} skipped (no van assigned)`,
        );
      } else {
        toast.success(`Updated schedule for ${result.updatedCount} customer(s)`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update schedule'),
  });
};

export const useUpdateCustomerLocation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerId, latitude, longitude, address }: { customerId: string; latitude: number; longitude: number; address?: string }) => {
      await customersApi.updateLocation(customerId, latitude, longitude);
      if (address) await customersApi.update(customerId, { address });
    },
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.one(customerId) });
      toast.success('Location updated');
    },
    onError: () => toast.error('Failed to update location'),
  });
};
