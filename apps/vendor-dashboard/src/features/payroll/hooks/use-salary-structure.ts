import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SalaryStructure } from '@water-supply-crm/types';
import { payrollApi, type CreateSalaryStructureData, type VoidSalaryStructureData } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * `POST /payroll/salary-structures` — starts a new versioned salary structure
 * (a raise/initial-set). The backend closes the previous row's `effectiveTo`
 * itself (Payroll Doc §4) — nothing here re-implements that; this hook only
 * posts and re-fetches the two cached views of an employee's salary.
 */
export const useCreateSalaryStructure = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSalaryStructureData): Promise<SalaryStructure> =>
      payrollApi.createSalaryStructure(data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.salaryHistory(variables.userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.effectiveSalary(variables.userId) });
      toast.success('Salary structure recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record salary structure'),
  });
};

/**
 * `POST /payroll/salary-structures/:id/void` — fixes a wrong amount/date
 * data-entry mistake without ever editing a row in place (owner-requested
 * 2026-09-25). Only the current/latest row is eligible; the backend reopens
 * whichever row it had trimmed. Mirrors `useVoidProductCost`.
 */
export const useVoidSalaryStructure = (employeeId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: VoidSalaryStructureData }): Promise<SalaryStructure> =>
      payrollApi.voidSalaryStructure(id, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.salaryHistory(employeeId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.effectiveSalary(employeeId) });
      toast.success('Salary structure row voided');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to void salary structure row'),
  });
};
