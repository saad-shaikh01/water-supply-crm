import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { ordersApi } from '../api/orders.api';

export const useOrders = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    status: status || undefined,
    search: search || undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  };

  return {
    ...useQuery({
      queryKey: ['vendor-orders', params],
      queryFn: () => ordersApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    status,
    setStatus,
    search,
    setSearch,
  };
};

export const useApproveOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ordersApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      toast.success('Order approved');
    },
    onError: () => toast.error('Failed to approve order'),
  });
};

export const useRejectOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rejectionReason }: { id: string; rejectionReason: string }) =>
      ordersApi.reject(id, { rejectionReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      toast.success('Order rejected');
    },
    onError: () => toast.error('Failed to reject order'),
  });
};
