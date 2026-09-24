import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StaffAdvancePlan } from '@water-supply-crm/types';
import {
  payrollApi,
  type CreateAdvancePlanData,
  type UpdateAdvancePlanData,
  type CollectAdvanceInstallmentData,
} from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';
import { useInvalidateEmployeeLedger } from './use-employee-profile';

/**
 * Advance Installments (owner-requested 2026-09-24) — data layer for the
 * Employee Financial Profile's Advance Plans card and the payroll draft
 * breakdown dialog's Advances tab. Mirrors this feature's existing hook
 * conventions (`use-ledger-entry.ts`, `use-attendance.ts`): mutations
 * invalidate the affected keys and toast in `onSuccess`/`onError`.
 */

export const useAdvancePlansForEmployee = (userId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.payroll.advancePlansByEmployee(userId ?? ''),
    queryFn: (): Promise<StaffAdvancePlan[]> =>
      payrollApi.getAdvancePlansForEmployee(userId as string).then((r) => r.data),
    enabled: !!userId,
  });
};

/**
 * `entryId` is optional — the New Advance Plan dialog is opened from the
 * Employee Financial Profile (no entry in view) as well as from the draft
 * breakdown dialog's Advances tab (an entry IS in view, so its cached
 * breakdown needs invalidating too).
 */
export const useCreateAdvancePlan = (entryId?: string) => {
  const queryClient = useQueryClient();
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  return useMutation({
    mutationFn: (data: CreateAdvancePlanData): Promise<StaffAdvancePlan> =>
      payrollApi.createAdvancePlan(data).then((r) => r.data),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.advancePlansByEmployee(variables.userId) });
      invalidateEmployeeLedger(variables.userId);
      if (entryId) queryClient.invalidateQueries({ queryKey: queryKeys.payroll.entryBreakdown(entryId) });
      toast.success('Advance plan created — cash disbursed, recovery starts next payroll draft');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create advance plan'),
  });
};

export const useUpdateAdvancePlan = (userId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAdvancePlanData }) =>
      payrollApi.updateAdvancePlan(id, data),
    onSuccess: () => {
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.payroll.advancePlansByEmployee(userId) });
      toast.success('Advance plan updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update advance plan'),
  });
};

/** Collect/Skip both act on one installment inside one entry's breakdown — `entryId` + `userId` are always known there. */
export const useCollectAdvanceInstallment = (entryId: string, userId: string) => {
  const queryClient = useQueryClient();
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CollectAdvanceInstallmentData }) =>
      payrollApi.collectAdvanceInstallment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.entryBreakdown(entryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.advancePlansByEmployee(userId) });
      invalidateEmployeeLedger(userId);
      toast.success('Installment collected');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to collect installment'),
  });
};

export const useSkipAdvanceInstallment = (entryId: string, userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => payrollApi.skipAdvanceInstallment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.entryBreakdown(entryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.advancePlansByEmployee(userId) });
      toast.success('Installment skipped — the balance rolls into next period');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to skip installment'),
  });
};
