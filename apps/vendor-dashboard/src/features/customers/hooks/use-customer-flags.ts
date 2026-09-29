import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CustomerFlag, CustomerFlagCategory } from '@water-supply-crm/types';
import { customerFlagCategoriesApi, customerFlagsApi } from '../api/customer-flags.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * Every place a customer's flag badge is displayed (list, daily-sheet
 * delivery rows, Communication Center) reads `flags` off the customer object
 * the way that surface already fetches it — this file only covers the
 * category catalogue and the apply/resolve mutations. A successful apply or
 * resolve invalidates every cache that embeds a customer, not just the
 * customer list, so the badge updates everywhere without a page refresh.
 */
function invalidateEverywhereCustomersAppear(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['customers'] });
  queryClient.invalidateQueries({ queryKey: ['sheets'] });
  queryClient.invalidateQueries({ queryKey: ['conversations'] });
  queryClient.invalidateQueries({ queryKey: ['conversation'] });
  queryClient.invalidateQueries({ queryKey: ['conversation-messages'] });
}

export const useCustomerFlagCategories = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.customerFlags.categories(),
    queryFn: (): Promise<CustomerFlagCategory[]> => customerFlagCategoriesApi.getAll().then((r) => r.data),
    enabled,
    staleTime: 60 * 1000,
  });

export const useCreateCustomerFlagCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color: string; defaultMessage?: string }): Promise<CustomerFlagCategory> =>
      customerFlagCategoriesApi.create(data).then((r) => r.data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerFlags.categories() });
      toast.success(`Category "${created.name}" added`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add category'),
  });
};

export const useUpdateCustomerFlagCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; color?: string; defaultMessage?: string; isActive?: boolean };
    }): Promise<CustomerFlagCategory> => customerFlagCategoriesApi.update(id, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerFlags.categories() });
      toast.success('Category updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update category'),
  });
};

export const useDeleteCustomerFlagCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customerFlagCategoriesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerFlags.categories() });
      toast.success('Category removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove category'),
  });
};

/** Full flag history (open + resolved) for one customer — the "why" trail. */
export const useCustomerFlagHistory = (customerId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.customerFlags.history(customerId),
    queryFn: (): Promise<CustomerFlag[]> => customerFlagsApi.history(customerId).then((r) => r.data),
    enabled: enabled && !!customerId,
  });

export const useApplyCustomerFlag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      data,
    }: {
      customerId: string;
      data: { categoryId: string; message?: string };
    }): Promise<CustomerFlag> => customerFlagsApi.apply(customerId, data).then((r) => r.data),
    onSuccess: (flag, { customerId }) => {
      invalidateEverywhereCustomersAppear(queryClient);
      queryClient.invalidateQueries({ queryKey: queryKeys.customerFlags.history(customerId) });
      toast.success(`Flagged — ${flag.category.name}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to apply flag'),
  });
};

export const useResolveCustomerFlag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      flagId,
      data,
    }: {
      customerId: string;
      flagId: string;
      data: { resolvedReason?: string };
    }): Promise<CustomerFlag> => customerFlagsApi.resolve(customerId, flagId, data).then((r) => r.data),
    onSuccess: (_, { customerId }) => {
      invalidateEverywhereCustomersAppear(queryClient);
      queryClient.invalidateQueries({ queryKey: queryKeys.customerFlags.history(customerId) });
      toast.success('Flag resolved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to resolve flag'),
  });
};
