import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ordersApi } from '../api/orders.api';

export const useOrders = (params: { page?: number; limit?: number; status?: string }) =>
  useQuery({
    queryKey: ['portal-orders', params],
    queryFn: () => ordersApi.getAll(params).then((r) => r.data),
  });

export const usePlaceOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-orders'] });
      toast.success('Order placed successfully');
    },
    onError: () => {
      toast.error('Failed to place order');
    },
  });
};

export const useCancelOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ordersApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-orders'] });
      toast.success('Order cancelled');
    },
    onError: () => {
      toast.error('Failed to cancel order');
    },
  });
};
