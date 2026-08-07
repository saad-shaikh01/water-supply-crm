import { useQuery } from '@tanstack/react-query';
import type { PayrollPeriod, PayrollEntry } from '@water-supply-crm/types';
import { payrollApi } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';
import { useEligibleEmployees } from './use-eligible-employees';

/**
 * The vendor's current OPEN payroll period — `POST /payroll/periods/open` is a
 * find-or-create endpoint (idempotent, safe to call repeatedly), the only period-read
 * surface `payroll-period.controller.ts` exposes (no dedicated GET). Gated on
 * `payroll:period_generate` by the caller via `enabled` — that's the permission the
 * endpoint itself requires.
 */
export const useOpenPayrollPeriod = (enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.payroll.openPeriod(),
    queryFn: (): Promise<PayrollPeriod> => payrollApi.getOrCreateOpenPeriod().then((r) => r.data),
    enabled,
  });
};

/**
 * Every `PayrollEntry` generated so far for a period — used to derive "total payable
 * this period" (sum of `finalPayable`). Gated on `payroll:view_all` by the caller
 * (the endpoint itself requires it — it is not a self-scoped read).
 */
export const usePeriodEntries = (periodId: string | undefined, enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.payroll.periodEntries(periodId ?? ''),
    queryFn: (): Promise<PayrollEntry[]> => payrollApi.getEntriesForPeriod(periodId as string).then((r) => r.data),
    enabled: enabled && !!periodId,
  });
};

/**
 * Vendor-wide count of PENDING `StaffLedgerEntry` rows awaiting approval — no
 * vendor-wide endpoint exists for this (`GET /payroll/ledger-entries/employee/:userId`
 * is per-employee only), so this fans out one PENDING-count read per payroll-eligible
 * employee and sums the totals. Acceptable at this app's staff scale (a handful to a
 * few dozen employees per vendor); would need a dedicated backend aggregate if that
 * ever stops being true. Gated on `payroll:view_all` by the caller, since reading
 * another employee's ledger requires it.
 */
export const usePendingLedgerCount = (enabled: boolean) => {
  const { data: employees, isLoading: employeesLoading } = useEligibleEmployees();

  return useQuery({
    queryKey: queryKeys.payroll.pendingLedgerCount(),
    queryFn: async (): Promise<number> => {
      const ids = (employees ?? []).map((e) => e.id);
      const counts = await Promise.all(
        ids.map((id) =>
          payrollApi
            .getLedgerForEmployee(id, { status: 'PENDING', limit: 1 })
            .then((r) => (r.data as { meta?: { total: number } }).meta?.total ?? 0),
        ),
      );
      return counts.reduce((sum, c) => sum + c, 0);
    },
    enabled: enabled && !employeesLoading && !!employees,
  });
};
