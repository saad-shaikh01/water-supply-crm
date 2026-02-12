import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { productsApi } from '../api/products.api';
import { queryKeys } from '../../../lib/query-keys';

export const useProducts = () => {
  return useQuery({
    queryKey: queryKeys.products.all,
    queryFn: () => productsApi.getAll().then((r) => r.data),
  });
};

export const useCreateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success('Product created successfully');
    },
    onError: () => toast.error('Failed to create product'),
  });
};

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success('Product updated');
    },
    onError: () => toast.error('Failed to update product'),
  });
};

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success('Product deleted');
    },
    onError: () => toast.error('Failed to delete product'),
  });
};

export const useToggleProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => productsApi.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success('Product status updated');
    },
    onError: () => toast.error('Failed to toggle product'),
  });
};
