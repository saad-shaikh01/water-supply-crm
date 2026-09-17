import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type CreateLedgerEntryData } from '../api/payroll.api';
import { useInvalidateEmployeeLedger } from './use-employee-profile';

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
