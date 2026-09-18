import { useIsMutating, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  vanCashLedgerApi,
  type CashLedgerDailyExportQuery,
  type CashLedgerDailyReportQuery,
  type CashLedgerDownload,
  type CashLedgerTimelineExportQuery,
} from '../api/van-cash-ledger.api';
import { readBlobError, saveBlob } from '../lib/download-file';

/**
 * Cash Ledger exports (P5). Each hook is a `useMutation` (no retry — an export
 * is a heavy request the user re-triggers on purpose): fetch the blob → save
 * it → one toast that morphs loading → ready / capped / error.
 *
 * All three share ONE toast id and one mutation-key root, so two exports never
 * stack duplicate toasts and every entry point (header menu, table controls,
 * day drawer) can reflect "an export is running" via `useCashLedgerExporting`.
 */

const TOAST_ID = 'cash-ledger-export';
const MUTATION_ROOT = 'van-cash-ledger-export';

export const CASH_LEDGER_EXPORT_ROW_CAP = 50_000;

function useDownloadMutation<V>(kind: string, run: (vars: V) => Promise<CashLedgerDownload>) {
  return useMutation<CashLedgerDownload, unknown, V>({
    mutationKey: [MUTATION_ROOT, kind],
    retry: 0,
    mutationFn: async (vars) => {
      const download = await run(vars);
      saveBlob(download.blob, download.filename);
      return download;
    },
    onMutate: () => {
      toast.loading('Preparing export…', { id: TOAST_ID });
    },
    onSuccess: (download) => {
      if (download.truncated) {
        toast.warning(
          `Export capped at ${CASH_LEDGER_EXPORT_ROW_CAP.toLocaleString('en-US')} rows — narrow the filters`,
          { id: TOAST_ID, description: download.filename },
        );
      } else {
        toast.success('Export ready', { id: TOAST_ID, description: download.filename });
      }
    },
    onError: async (error) => {
      toast.error(await readBlobError(error), { id: TOAST_ID });
    },
  });
}

/** Timeline CSV — current entry filters + date / van (no paging; capped server-side). */
export const useExportTimelineCsv = () =>
  useDownloadMutation<CashLedgerTimelineExportQuery>('timeline', (p) => vanCashLedgerApi.exportTimelineCsv(p));

/** Daily table CSV — the table's group + include-empty state. */
export const useExportDailyCsv = () =>
  useDownloadMutation<CashLedgerDailyExportQuery>('daily', (p) => vanCashLedgerApi.exportDailyCsv(p));

/** One day's cash report as a PDF. */
export const useDownloadDailyReportPdf = () =>
  useDownloadMutation<CashLedgerDailyReportQuery>('report', (p) => vanCashLedgerApi.downloadDailyReportPdf(p));

/** Daily-table export params from the table state — `includeEmpty` only when true, never a literal `false`. */
export function dailyExportParams(state: {
  vanId: string;
  range: { from?: string; to?: string };
  group: CashLedgerDailyExportQuery['group'];
  includeEmpty: boolean;
}): CashLedgerDailyExportQuery {
  return {
    vanId: state.vanId || undefined,
    from: state.range.from,
    to: state.range.to,
    group: state.group,
    includeEmpty: state.includeEmpty ? true : undefined,
  };
}

/** True while ANY Cash Ledger export is in flight (across components) — used to disable every trigger. */
export const useCashLedgerExporting = (): boolean =>
  useIsMutating({ mutationKey: [MUTATION_ROOT] }) > 0;
