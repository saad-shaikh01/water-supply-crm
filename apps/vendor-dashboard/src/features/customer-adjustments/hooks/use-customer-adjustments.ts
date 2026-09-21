import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  apiErrorMessage,
  customerAdjustmentsApi,
  type CreateAdjustmentPayload,
  type CustomerAdjustmentQuery,
} from '../api/customer-adjustments.api';
import { adjustmentKindLabel, fmtAdjustmentAmount } from '../format';

/**
 * Root key for everything in this feature. Posting / voiding invalidates it together with the
 * customer (the balance moved) and everything else the new ledger row feeds.
 */
export const CUSTOMER_ADJUSTMENTS_QUERY_KEY = 'customer-adjustments';

export const useCustomerAdjustments = (params: CustomerAdjustmentQuery, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: [CUSTOMER_ADJUSTMENTS_QUERY_KEY, 'list', params],
    queryFn: () => customerAdjustmentsApi.list(params).then((r) => r.data),
    // Keep the previous page on screen while the next filter/page loads (no table flicker).
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
  });

/**
 * An adjustment (or its void) writes a ledger row and moves `Customer.financialBalance`, so refresh
 * this feature's list, the customer (detail + lists + statement), the Transactions ledger, and the
 * analytics / dashboard figures — the same set the payment mutations refresh.
 */
const invalidateAfterMutation = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: [CUSTOMER_ADJUSTMENTS_QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: ['customers'] });
  queryClient.invalidateQueries({ queryKey: ['customer'] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['analytics'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
};

export const useCreateCustomerAdjustment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAdjustmentPayload) => customerAdjustmentsApi.create(payload).then((r) => r.data),
    onSuccess: (result) => {
      invalidateAfterMutation(queryClient);
      const { kind, amount } = result.adjustment;
      toast.success(
        result.idempotentReplay
          ? 'This adjustment was already posted — nothing was added twice'
          : `${adjustmentKindLabel(kind)} of ${fmtAdjustmentAmount(amount)} posted`,
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to post the adjustment')),
  });
};

export const useVoidCustomerAdjustment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      customerAdjustmentsApi.void(id, reason).then((r) => r.data),
    onSuccess: () => {
      invalidateAfterMutation(queryClient);
      toast.success('Adjustment voided — a reversal was posted');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to void the adjustment')),
  });
};
