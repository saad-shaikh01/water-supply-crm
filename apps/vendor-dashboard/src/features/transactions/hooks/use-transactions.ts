import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { transactionsApi, type TransactionQuery } from '../api/transactions.api';
import { queryKeys } from '../../../lib/query-keys';

const invalidatePaymentRequestDependencies = async (queryClient: ReturnType<typeof useQueryClient>) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['payment-requests'] }),
    queryClient.invalidateQueries({ queryKey: ['transactions'] }),
    queryClient.invalidateQueries({ queryKey: ['customers'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics', 'financial'] }),
  ]);
};

/**
 * Invalidate every read that a payment's amount feeds — ledger, the customer's
 * balance, dashboards and analytics. Shared by the add / edit / delete payment
 * flows so all of them refresh the overview + analytics snapshots, not just the
 * transactions and customers lists.
 */
const invalidatePaymentMutationDependencies = (
  queryClient: ReturnType<typeof useQueryClient>,
) => {
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['customers'] });
  queryClient.invalidateQueries({ queryKey: ['customer'] });
  queryClient.invalidateQueries({ queryKey: ['analytics'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
};

export const useTransactions = (overrideCustomerId?: string) => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [urlCustomerId, setCustomerId] = useQueryState('customerId', parseAsString.withDefault(''));
  const [vanId, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [type, setType] = useQueryState('type', parseAsString.withDefault(''));
  const [paymentMode, setPaymentMode] = useQueryState('paymentMode', parseAsString.withDefault(''));
  // Default to empty (not current-month) so "Clear All" can actually clear the
  // date filter. nuqs reverts to the default when set to null, so a non-empty
  // default made the date chip impossible to remove. Use the "This Month"
  // preset button to re-apply the current-month range on demand.
  const [dateFrom, setDateFrom] = useQueryState('dateFrom', parseAsString.withDefault(''));
  const [dateTo, setDateTo] = useQueryState('dateTo', parseAsString.withDefault(''));

  const effectiveCustomerId = overrideCustomerId || urlCustomerId;

  const params: TransactionQuery = {
    page,
    limit,
    search: search || undefined,
    customerId: effectiveCustomerId || undefined,
    vanId: vanId || undefined,
    type: type || undefined,
    paymentMode: paymentMode || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
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
    search,
    setSearch,
    customerId: effectiveCustomerId,
    setCustomerId,
    vanId,
    setVanId,
    type,
    setType,
    paymentMode,
    setPaymentMode,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  };
};

/**
 * Monthly snapshot for the Record Payment dialog — prev-month outstanding and
 * how much the customer has already paid this month. Fetched lazily (only when
 * the dialog is open for a customer).
 */
export const useCustomerPrevMonthOutstanding = (customerId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['customer-prev-month-outstanding', customerId],
    queryFn: () => transactionsApi.getPrevMonthOutstanding(customerId).then((r) => r.data),
    enabled: enabled && !!customerId,
    staleTime: 1000 * 60 * 2,
  });

export const useAddPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) =>
      transactionsApi.addPayment(customerId, data),
    onSuccess: () => {
      // Mirror edit/delete payment — also refresh dashboard + analytics reads so
      // Pending Balance / Outstanding / today's Collections move immediately.
      invalidatePaymentMutationDependencies(queryClient);
      toast.success('Payment recorded');
    },
    onError: () => toast.error('Failed to record payment'),
  });
};

const fmt = (n: unknown) => `₨${Number(n ?? 0).toLocaleString()}`;

interface MutationError {
  response?: { status?: number; data?: { message?: string } };
}

export const useEditPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      transactionsApi.editPayment(id, data).then((r) => r.data),
    onSuccess: (result: {
      previousAmount?: number;
      newAmount?: number;
      newBalance?: number;
    }) => {
      invalidatePaymentMutationDependencies(queryClient);
      toast.success(
        `Payment updated: ${fmt(result?.previousAmount)} → ${fmt(result?.newAmount)}. New balance ${fmt(result?.newBalance)}.`,
      );
    },
    onError: (error: unknown) => {
      const err = error as MutationError;
      // A 409 means our `expectedUpdatedAt` was stale — pull a fresh list so the
      // next attempt carries the current token.
      if (err?.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      }
      toast.error(err?.response?.data?.message ?? 'Failed to update payment');
    },
  });
};

export const useDeletePayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      transactionsApi.deletePayment(id, data).then((r) => r.data),
    onSuccess: (result: { reversedAmount?: number }) => {
      invalidatePaymentMutationDependencies(queryClient);
      toast.success(
        `Payment removed. Customer balance restored by ${fmt(result?.reversedAmount)}.`,
      );
    },
    onError: (error: unknown) => {
      const err = error as MutationError;
      if (err?.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      }
      toast.error(err?.response?.data?.message ?? 'Failed to remove payment');
    },
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
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [customerId, setCustomerId] = useQueryState('customerId', parseAsString.withDefault(''));
  const [method, setMethod] = useQueryState('method', parseAsString.withDefault(''));
  // Empty default so "Clear" can actually remove the date filter (a non-empty
  // default would revert to the current-month range when cleared).
  const [dateFrom, setDateFrom] = useQueryState('dateFrom', parseAsString.withDefault(''));
  const [dateTo, setDateTo] = useQueryState('dateTo', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    status: status || undefined,
    customerId: customerId || undefined,
    method: method || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

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
    setStatus,
    customerId,
    setCustomerId,
    method,
    setMethod,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  };
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => transactionsApi.approveRequest(id),
    onSuccess: async () => {
      await invalidatePaymentRequestDependencies(queryClient);
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
    onSuccess: async () => {
      await invalidatePaymentRequestDependencies(queryClient);
      toast.success('Payment rejected');
    },
    onError: () => toast.error('Failed to reject payment'),
  });
};
