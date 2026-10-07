import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type PayrollCsvDownload } from '../api/payroll.api';
import { readBlobError, saveBlob } from '../../van-cash-ledger/lib/download-file';

const TOAST_ID = 'payroll-export';

/**
 * Monthly Payroll → Export CSV. Same shape as the Cash Ledger exports (`useDownloadMutation`): no retry — an
 * export is re-triggered on purpose — fetch the blob, save it, one toast that morphs loading → ready / error.
 */
export function usePayrollExport() {
  return useMutation<PayrollCsvDownload, unknown, { periodId: string; periodLabel: string }>({
    mutationKey: ['payroll-export'],
    retry: 0,
    mutationFn: async ({ periodId, periodLabel }) => {
      const download = await payrollApi.exportPeriodCsv(periodId, periodLabel);
      saveBlob(download.blob, download.filename);
      return download;
    },
    onMutate: () => {
      toast.loading('Preparing payroll export…', { id: TOAST_ID });
    },
    onSuccess: (download) => {
      toast.success('Payroll export ready', { id: TOAST_ID, description: download.filename });
    },
    onError: async (error) => {
      toast.error(await readBlobError(error), { id: TOAST_ID });
    },
  });
}
