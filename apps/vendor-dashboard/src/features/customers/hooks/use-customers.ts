import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { customersApi } from '../api/customers.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCustomers = () => {
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [routeId] = useQueryState('routeId', parseAsString.withDefault(''));
  const [paymentType] = useQueryState('paymentType', parseAsString.withDefault(''));
  const [isActive, setIsActive] = useQueryState('isActive', parseAsString.withDefault(''));

  const params = {
    search: search || undefined,
    page,
    limit,
    routeId: routeId || undefined,
    paymentType: (paymentType as 'MONTHLY' | 'CASH') || undefined,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
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
    paymentType,
    isActive,
    setIsActive,
  };
};

export const useCustomer = (id: string) => {
  return useQuery({
    queryKey: queryKeys.customers.one(id),
    queryFn: () => customersApi.getOne(id).then((r) => r.data),
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

export const useCustomerConsumption = (id: string, month?: string) =>
  useQuery({
    queryKey: ['customers', id, 'consumption', month],
    queryFn: () => customersApi.getConsumption(id, month ? { month } : undefined).then((r) => r.data),
    enabled: !!id,
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
