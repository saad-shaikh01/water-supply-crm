import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type CreateLedgerEntryData, type CreateLinkedPenaltyData } from '../api/payroll.api';
import { useInvalidateEmployeeLedger } from './use-employee-profile';
import { invalidateAfterMutation } from '../../customer-adjustments/hooks/use-customer-adjustments';

export const useCreateLedgerEntry = () => {
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLedgerEntryData) => payrollApi.createLedgerEntry(data),
    onSuccess: (_res, variables) => {
      invalidateEmployeeLedger(variables.userId);
      // A non-CREW_CASH ledger entry also projects into Expense Center's
      // Timeline and, once no longer a same-day sheet cost, the Van Cash
      // Ledger's CASH_OUT rows — see use-expenses.ts's useCreateExpense
      // identical note. Without these, the Add Expense wizard's "Ledger"
      // stage leaves both pages showing stale data until a manual reload.
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Ledger entry recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record ledger entry'),
  });
};

/**
 * Void a mistaken ledger entry (PENDING, or POSTED and not yet in a locked period).
 * `linked` routes to the linked-penalty endpoint, which reverses the paired customer
 * credit in the same transaction. Ledger rows are never edited in place — "edit" is
 * void + re-add.
 */
export const useVoidLedgerEntry = () => {
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, reason, linked }: { id: string; version: number; reason: string; linked?: boolean; userId: string }) =>
      linked ? payrollApi.voidLinkedPenalty(id, { version, reason }) : payrollApi.voidLedgerEntry(id, { version, reason }),
    onSuccess: (_res, variables) => {
      invalidateEmployeeLedger(variables.userId);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'entry-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      if (variables.linked) invalidateAfterMutation(queryClient);
      toast.success('Entry voided');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to void entry'),
  });
};

/** Reverse (cancel) or correct (cancel + re-post at `correctedAmount`) an entry already in a locked period. */
export const useAdjustLockedLedgerEntry = () => {
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; userId: string; version: number; reason: string; correctedAmount?: number }) =>
      v.correctedAmount === undefined
        ? payrollApi.reverseLedgerEntry(v.id, { version: v.version, reason: v.reason })
        : payrollApi.correctLedgerEntry(v.id, { version: v.version, reason: v.reason, correctedAmount: v.correctedAmount }),
    onSuccess: (_res, v) => {
      invalidateEmployeeLedger(v.userId);
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success(v.correctedAmount === undefined ? 'Entry reversed' : 'Entry corrected');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to adjust entry'),
  });
};

/**
 * Linked Penalty (owner-approved 2026-09-25) — atomically debits the employee AND
 * credits the named customer the same amount. Invalidates both the employee's
 * ledger (payroll side) and the customer-adjustments data (Charges & Credits tab,
 * customer balance, statement, analytics) the same way `useCreateLinkedPenalty`'s
 * customer-side counterpart, `useCreateBalanceTransfer`, does.
 */
export const useCreateLinkedPenalty = () => {
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLinkedPenaltyData) => payrollApi.createLinkedPenalty(data),
    onSuccess: (_res, variables) => {
      invalidateEmployeeLedger(variables.userId);
      invalidateAfterMutation(queryClient);
      toast.success('Penalty recorded and customer credited');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record the linked penalty'),
  });
};
