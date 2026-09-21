import { useQuery } from '@tanstack/react-query';
import { customerAdjustmentsApi, type CustomerAdjustmentQuery } from '../api/customer-adjustments.api';

/**
 * Root key for everything in this feature. The posting/void mutations (later phases) will
 * invalidate it together with ['customers'] / ['customer'] (the balance moves too).
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
