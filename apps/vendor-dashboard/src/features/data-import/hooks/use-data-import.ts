import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  dataImportApi,
  type ExecutePayload,
  type ImportBatch,
  type RowsQuery,
  type SaveMappingPayload,
} from '../api/data-import.api';

const KEY = 'data-imports';

/** Extract the server's `{ code, message }` (see ImportErrorFilter) or fall back. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importErrorOf(e: any, fallback: string): { code: string | null; message: string } {
  const d = e?.response?.data;
  const message = Array.isArray(d?.message) ? d.message.join(', ') : (d?.message ?? fallback);
  return { code: d?.code ?? null, message };
}

export const isRunning = (b?: Pick<ImportBatch, 'status' | 'summary'> | null) =>
  !!b && (b.status === 'QUEUED' || b.status === 'EXECUTING' || b.summary?.revert?.state === 'RUNNING');

export const useImportList = (params?: { page?: number; limit?: number }) =>
  useQuery({
    queryKey: [KEY, 'list', params ?? {}],
    queryFn: () => dataImportApi.list(params).then((r) => r.data),
    // Keep the history fresh while something on it is still running.
    refetchInterval: (q) => (q.state.data?.data.some((b) => isRunning(b)) ? 3000 : false),
  });

export const useImportDetail = (id: string | undefined) =>
  useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => dataImportApi.get(id as string).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (q) => (isRunning(q.state.data?.batch) ? 2000 : false),
  });

export const useImportRows = (id: string | undefined, params: RowsQuery, enabled = true) =>
  useQuery({
    queryKey: [KEY, 'rows', id, params],
    queryFn: () => dataImportApi.rows(id as string, params).then((r) => r.data),
    enabled: !!id && enabled,
    placeholderData: (prev) => prev,
  });

export const useColumnValues = (id: string | undefined, header: string | null) =>
  useQuery({
    queryKey: [KEY, 'column-values', id, header],
    queryFn: () => dataImportApi.columnValues(id as string, header as string).then((r) => r.data),
    enabled: !!id && !!header,
    staleTime: 60_000,
  });

export const useUploadImport = () =>
  useMutation({
    mutationFn: (v: { entity: string; file: File; sheetName?: string; headerRow?: number; replaceBatchId?: string }) =>
      dataImportApi.upload(v.entity, v.file, v).then((r) => r.data),
  });

export const useSaveMapping = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveMappingPayload) => dataImportApi.saveMapping(id, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'detail', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'rows', id] });
    },
  });
};

export const useExecuteImport = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ExecutePayload) => dataImportApi.execute(id, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
};

export const useCancelImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataImportApi.cancel(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
      toast.success('Import cancelled');
    },
    onError: (e) => toast.error(importErrorOf(e, 'Could not cancel the import').message),
  });
};

export const useRevertPreview = () =>
  useMutation({ mutationFn: (id: string) => dataImportApi.revertPreview(id).then((r) => r.data) });

export const useRevertImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataImportApi.revert(id).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
};

/** Save a Blob response (report / template) through a temporary link. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadReport(id: string) {
  try {
    const res = await dataImportApi.report(id);
    saveBlob(res.data, `import-report-${id.slice(0, 8)}.xlsx`);
  } catch (e) {
    toast.error(importErrorOf(e, 'Could not download the report').message);
  }
}

export async function downloadTemplate(entity: string) {
  try {
    const res = await dataImportApi.template(entity);
    saveBlob(res.data, `${entity.toLowerCase().replace(/_/g, '-')}-template.xlsx`);
  } catch (e) {
    toast.error(importErrorOf(e, 'Could not download the template').message);
  }
}

export async function downloadSource(id: string) {
  try {
    const res = await dataImportApi.sourceUrl(id);
    window.open(res.data.signedUrl, '_blank', 'noopener');
  } catch (e) {
    toast.error(importErrorOf(e, 'The original file is not available').message);
  }
}
