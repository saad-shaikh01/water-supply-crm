import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { customersApi } from '../api/customers.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCustomers = () => {
  const [search] = useQueryState('search', { defaultValue: '' });
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [routeId] = useQueryState('routeId', { defaultValue: '' });

  const params = {
    search: search || undefined,
    page,
    limit: 20,
    routeId: routeId || undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.customers.all(params),
      queryFn: () => customersApi.getAll(params).then((r) => r.data),
    }),
    search,
    page,
    routeId,
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
