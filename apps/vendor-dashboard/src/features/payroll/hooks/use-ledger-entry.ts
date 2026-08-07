import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type CreateLedgerEntryData } from '../api/payroll.api';
import { useInvalidateEmployeeLedger } from './use-employee-profile';

export const useCreateLedgerEntry = () => {
  const invalidateEmployeeLedger = useInvalidateEmployeeLedger();
  return useMutation({
    mutationFn: (data: CreateLedgerEntryData) => payrollApi.createLedgerEntry(data),
    onSuccess: (_res, variables) => {
      invalidateEmployeeLedger(variables.userId);
      toast.success('Ledger entry recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record ledger entry'),
  });
};
