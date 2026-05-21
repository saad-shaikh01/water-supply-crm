import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { ordersApi } from '../api/orders.api';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';

export const useOrders = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [customerId, setCustomerId] = useQueryState('customerId', parseAsString.withDefault(''));
  const [productId, setProductId] = useQueryState('productId', parseAsString.withDefault(''));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    status: status || undefined,
    search: search || undefined,
    customerId: customerId || undefined,
    productId: productId || undefined,
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
    customerId,
    setCustomerId,
    productId,
    setProductId,
    from,
    setFrom,
    to,
    setTo,
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

export const useSaveDispatchPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
      hasExistingPlan,
    }: {
      id: string;
      data: {
        targetDate: string;
        timeWindow?: string;
        vanId?: string;
        driverId?: string;
        dispatchMode: string;
        notes?: string;
      };
      hasExistingPlan: boolean;
    }) =>
      hasExistingPlan
        ? ordersApi.updateDispatchPlan(id, data)
        : ordersApi.createDispatchPlan(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      toast.success('Dispatch plan saved');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to save dispatch plan'),
  });
};

export const useDispatchOrderNow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ordersApi.dispatchNow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      toast.success('Order marked as dispatched');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to dispatch order'),
  });
};

export const useBulkApproveOrders = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderIds: string[]) => ordersApi.bulkApprove(orderIds),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      const { approved, skipped } = (res.data as any) ?? {};
      toast.success(`${approved} order(s) approved${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    },
    onError: () => toast.error('Bulk approve failed'),
  });
};

export const useBulkPlanOrders = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderIds, targetDate }: { orderIds: string[]; targetDate: string }) =>
      ordersApi.bulkPlan(orderIds, targetDate),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      const { planned, skipped } = (res.data as any) ?? {};
      toast.success(`${planned} order(s) planned${skipped > 0 ? `, ${skipped} skipped` : ''}`);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Bulk plan failed'),
  });
};

export const useInsertOrderIntoSheet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sheetId, orderId }: { sheetId: string; orderId: string }) =>
      dailySheetsApi.insertItemFromOrder(sheetId, { orderId, sequenceMode: 'APPEND' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Order inserted into the selected sheet');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to insert order into sheet'),
  });
};
