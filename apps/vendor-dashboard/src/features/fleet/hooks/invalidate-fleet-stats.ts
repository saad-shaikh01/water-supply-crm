import type { QueryClient } from '@tanstack/react-query';

/**
 * Fuel fills, service records and attributed expenses all feed the per-vehicle
 * cost/km figures (list rows, period summary, month-wise report) — refresh
 * every derived view after any of them changes.
 */
export const invalidateFleetStats = (queryClient: QueryClient) => {
  for (const key of ['vehicles', 'monthly-report', 'period-summary', 'other-expenses', 'cost-summary', 'overview']) {
    queryClient.invalidateQueries({ queryKey: ['fleet', key] });
  }
};
