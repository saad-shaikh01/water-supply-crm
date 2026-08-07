import { useQuery } from '@tanstack/react-query';
import type { PayrollPeriod } from '@water-supply-crm/types';
import { payrollApi } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/** Every payroll period for the vendor, newest first — Payroll History (§12). */
export const usePayrollPeriods = (enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.payroll.periods(),
    queryFn: (): Promise<PayrollPeriod[]> => payrollApi.listPeriods().then((r) => r.data),
    enabled,
  });
};

/**
 * One historical period by id, resolved client-side out of the same cached
 * `GET /payroll/periods` list Payroll History already fetches — there is no
 * dedicated `GET /payroll/periods/:id`, and `POST /payroll/periods/open`
 * always resolves to the vendor's *current* OPEN period regardless of id, so
 * it can't be reused for viewing a past (LOCKED/PAID) period. Lets the
 * Monthly Payroll table be reused as-is for a historical period without a
 * new backend endpoint.
 */
export const useHistoricalPeriod = (periodId: string | undefined, enabled: boolean) => {
  const query = usePayrollPeriods(enabled && !!periodId);
  const period = query.data?.find((p) => p.id === periodId);
  const notFound = !query.isLoading && !query.isError && !!periodId && enabled && !period;

  return {
    data: period,
    isLoading: query.isLoading,
    isError: query.isError || notFound,
  };
};
