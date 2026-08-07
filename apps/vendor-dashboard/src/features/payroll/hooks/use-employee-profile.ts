import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SalaryStructure, StaffLedgerEntry } from '@water-supply-crm/types';
import { payrollApi, type LedgerEntryQuery } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

export const useSalaryHistory = (userId: string) => {
  return useQuery({
    queryKey: queryKeys.payroll.salaryHistory(userId),
    queryFn: (): Promise<SalaryStructure[]> => payrollApi.getSalaryHistory(userId).then((r) => r.data),
    enabled: !!userId,
  });
};

export const useEffectiveSalaryStructure = (userId: string) => {
  return useQuery({
    queryKey: queryKeys.payroll.effectiveSalary(userId),
    queryFn: (): Promise<SalaryStructure | null> => payrollApi.getEffectiveSalary(userId).then((r) => r.data),
    enabled: !!userId,
  });
};

interface UnsettledLedgerSummary {
  /** Sum of POSTED, not-yet-rolled-into-a-period entries — the employee's current net balance. */
  netBalance: number;
  /** Outstanding ADVANCE entries within the same unsettled set (positive magnitude). */
  outstandingAdvancesTotal: number;
  outstandingAdvances: StaffLedgerEntry[];
}

/**
 * §8 items 1–2 ("current net balance", "outstanding advances") — there is no dedicated
 * balance/aggregate endpoint, so this is derived client-side from POSTED ledger entries
 * whose `payrollEntryId` is still null (i.e. not yet rolled into a locked period — the
 * schema's own definition of "open"/unsettled). Fetches the newest 100 POSTED entries
 * (the DTO's page-size ceiling); since entries only stay unsettled until the next period
 * lock, and this reads newest-first, that ceiling would only be a problem if a single
 * employee accumulated over 100 unsettled ledger events within one open period — not
 * realistic at this business's scale, but worth knowing if this hook is ever reused
 * for a much larger vendor.
 */
export const useUnsettledLedgerSummary = (userId: string) => {
  return useQuery({
    queryKey: queryKeys.payroll.unsettledLedger(userId),
    queryFn: async (): Promise<UnsettledLedgerSummary> => {
      const res = await payrollApi.getLedgerForEmployee(userId, { status: 'POSTED', limit: 100 });
      const body = res.data as { data: StaffLedgerEntry[] };
      const unsettled = body.data.filter((e) => !e.payrollEntryId);
      const netBalance = unsettled.reduce((sum, e) => sum + e.amount, 0);
      const outstandingAdvances = unsettled.filter((e) => e.category === 'ADVANCE');
      const outstandingAdvancesTotal = outstandingAdvances.reduce((sum, e) => sum - e.amount, 0);
      return { netBalance, outstandingAdvancesTotal, outstandingAdvances };
    },
    enabled: !!userId,
  });
};

export const useLedgerTimeline = (userId: string, params: LedgerEntryQuery) => {
  return useQuery({
    queryKey: queryKeys.payroll.ledgerTimeline(userId, params),
    queryFn: (): Promise<{ data: StaffLedgerEntry[]; meta: { total: number; page: number; limit: number } }> =>
      payrollApi.getLedgerForEmployee(userId, params).then((r) => r.data),
    enabled: !!userId,
  });
};

/** Invalidate every cached view of one employee's ledger — call after a successful create. */
export const useInvalidateEmployeeLedger = () => {
  const queryClient = useQueryClient();
  return (userId: string) => {
    queryClient.invalidateQueries({ queryKey: ['payroll', 'unsettled-ledger', userId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'ledger-timeline', userId] });
    queryClient.invalidateQueries({ queryKey: queryKeys.payroll.pendingLedgerCount() });
  };
};
