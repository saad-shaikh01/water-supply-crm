import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { transactionsApi, type TransactionQuery } from '../api/transactions.api';
import { queryKeys } from '../../../lib/query-keys';

export const useTransactions = (overrideCustomerId?: string) => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [urlCustomerId] = useQueryState('customerId', { defaultValue: '' });
  const [type] = useQueryState('type', { defaultValue: '' });

  const effectiveCustomerId = overrideCustomerId || urlCustomerId;

  const params: TransactionQuery = {
    page,
    limit,
    customerId: effectiveCustomerId || undefined,
    type: type || undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.transactions.all(params),
      queryFn: () => transactionsApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    customerId: effectiveCustomerId,
    type,
  };
};

export const useAddPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) =>
      transactionsApi.addPayment(customerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Payment recorded');
    },
    onError: () => toast.error('Failed to record payment'),
  });
};

export const useAddAdjustment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) =>
      transactionsApi.addAdjustment(customerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Adjustment recorded');
    },
    onError: () => toast.error('Failed to record adjustment'),
  });
};

export const usePaymentRequests = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status] = useQueryState('status', { defaultValue: 'PENDING' });

  const params = { page, limit, status: status || undefined };

  return {
    ...useQuery({
      queryKey: ['payment-requests', params],
      queryFn: () => transactionsApi.getRequests(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    status,
  };
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transactionsApi.approveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      toast.success('Payment approved successfully');
    },
    onError: () => toast.error('Failed to approve payment'),
  });
};

export const useRejectRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => 
      transactionsApi.rejectRequest(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      toast.success('Payment rejected');
    },
    onError: () => toast.error('Failed to reject payment'),
  });
};
