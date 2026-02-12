import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { transactionsApi, type TransactionQuery } from '../api/transactions.api';
import { queryKeys } from '../../../lib/query-keys';

export const useTransactions = () => {
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [customerId] = useQueryState('customerId', { defaultValue: '' });
  const [type] = useQueryState('type', { defaultValue: '' });

  const params: TransactionQuery = {
    page,
    limit: 20,
    customerId: customerId || undefined,
    type: type || undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.transactions.all(params),
      queryFn: () => transactionsApi.getAll(params).then((r) => r.data),
    }),
    page,
    customerId,
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
