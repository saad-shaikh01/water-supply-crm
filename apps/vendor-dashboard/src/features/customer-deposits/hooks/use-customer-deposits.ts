import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  apiErrorMessage,
  customerDepositsApi,
  type ApplyDepositToBalancePayload,
  type CollectDepositPayload,
  type RefundDepositPayload,
  type WriteOffDepositPayload,
} from '../api/customer-deposits.api';
import { depositTitle, fmtDepositAmount } from '../format';

/** Root key for everything in this feature. */
export const CUSTOMER_DEPOSITS_QUERY_KEY = 'customer-deposits';

/** Vendor-wide: whether the feature is turned on at all. */
export const useDepositsConfig = () =>
  useQuery({
    queryKey: [CUSTOMER_DEPOSITS_QUERY_KEY, 'config'],
    queryFn: () => customerDepositsApi.getConfig().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

export const useUpdateDepositsConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depositsEnabled: boolean) => customerDepositsApi.updateConfig(depositsEnabled).then((r) => r.data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [CUSTOMER_DEPOSITS_QUERY_KEY] });
      toast.success(result.depositsEnabled ? 'Customer Deposits enabled' : 'Customer Deposits disabled');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to change the setting')),
  });
};

export const useCustomerDeposits = (customerId: string, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [CUSTOMER_DEPOSITS_QUERY_KEY, 'list', customerId],
    queryFn: () => customerDepositsApi.listForCustomer(customerId).then((r) => r.data),
    enabled: (options?.enabled ?? true) && !!customerId,
  });

/**
 * A deposit action writes an entry and moves a CustomerDeposit balance (and, for
 * apply-to-balance, the customer's financialBalance too), so refresh this
 * feature's list, the customer (detail + lists + statement), the Transactions
 * ledger, and analytics — the same set the adjustment mutations refresh.
 */
const invalidateAfterMutation = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: [CUSTOMER_DEPOSITS_QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: ['customers'] });
  queryClient.invalidateQueries({ queryKey: ['customer'] });
  queryClient.invalidateQueries({ queryKey: ['customer-adjustments'] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['analytics'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
};

export const useCollectDeposit = (customerId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CollectDepositPayload) => customerDepositsApi.collect(customerId, payload).then((r) => r.data),
    onSuccess: (result) => {
      invalidateAfterMutation(queryClient);
      toast.success(`${depositTitle(result.deposit)} collected — ${fmtDepositAmount(result.deposit.type, result.entry.amount)}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to collect the deposit')),
  });
};

export const useRefundDeposit = (depositId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RefundDepositPayload) => customerDepositsApi.refund(depositId, payload).then((r) => r.data),
    onSuccess: (result) => {
      invalidateAfterMutation(queryClient);
      toast.success(`${fmtDepositAmount(result.deposit.type, result.entry.amount)} refunded`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to refund the deposit')),
  });
};

export const useApplyDepositToBalance = (depositId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApplyDepositToBalancePayload) =>
      customerDepositsApi.applyToBalance(depositId, payload).then((r) => r.data),
    onSuccess: (result) => {
      invalidateAfterMutation(queryClient);
      toast.success(`${fmtDepositAmount('CASH', result.entry.amount)} applied to the customer's balance`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to apply the deposit to the balance')),
  });
};

export const useWriteOffDeposit = (depositId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WriteOffDepositPayload) => customerDepositsApi.writeOff(depositId, payload).then((r) => r.data),
    onSuccess: (result) => {
      invalidateAfterMutation(queryClient);
      toast.success(`${fmtDepositAmount(result.deposit.type, result.entry.amount)} written off`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to write off the deposit')),
  });
};

export const useVoidDepositEntry = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) =>
      customerDepositsApi.voidEntry(entryId, reason).then((r) => r.data),
    onSuccess: () => {
      invalidateAfterMutation(queryClient);
      toast.success('Entry voided — a reversal was posted');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to void the entry')),
  });
};
