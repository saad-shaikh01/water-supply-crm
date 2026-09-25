import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type PayrollVendorConfigData, type UpdatePayrollVendorConfigData } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * Dual-Cutoff Payroll Flexibility (owner-requested 2026-09-25) — the vendor
 * Settings page's data layer for `PayrollVendorConfig` (attendance cutoff
 * day + the optional, separately-anchored cash-deduction window).
 */
export const usePayrollVendorConfig = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.payroll.vendorConfig(),
    queryFn: (): Promise<PayrollVendorConfigData> => payrollApi.getVendorConfig().then((r) => r.data),
    enabled,
  });
};

export const useUpdatePayrollVendorConfig = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdatePayrollVendorConfigData) => payrollApi.updateVendorConfig(data).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.payroll.vendorConfig(), data);
      toast.success('Payroll settings updated.');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message ?? 'Failed to update payroll settings.');
    },
  });
};
