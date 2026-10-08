import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type SendSlipsData, type SendSlipsResult, type SlipStatusResponse } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/** How often the table's slip chips + progress banner refresh while a send is running. */
const ACTIVE_POLL_MS = 3000;

/**
 * Per-entry "slip sent / failed" state + the running dispatch's progress. Polls only while a send is active;
 * when it finishes, fires one summary toast. Gate with `enabled` (payroll:view_all — the server's own gate).
 */
export function useSlipStatus(periodId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.payroll.slipStatus(periodId ?? ''),
    queryFn: (): Promise<SlipStatusResponse> => payrollApi.getSlipStatus(periodId as string).then((r) => r.data),
    enabled: enabled && !!periodId,
    refetchInterval: (q) => (q.state.data?.activeDispatch ? ACTIVE_POLL_MS : false),
  });

  // One summary toast when the dispatch we were watching stops being active.
  const watching = useRef<string | null>(null);
  const active = query.data?.activeDispatch ?? null;
  const latest = query.data?.latestDispatch ?? null;
  useEffect(() => {
    if (active) {
      watching.current = active.id;
      return;
    }
    if (watching.current && latest && latest.id === watching.current) {
      const parts = [`${latest.sent} sent`];
      if (latest.failed) parts.push(`${latest.failed} failed`);
      if (latest.skipped) parts.push(`${latest.skipped} skipped`);
      const message = `Salary slips: ${parts.join(', ')}`;
      if (latest.status === 'ABORTED') toast.warning(`${message} — WhatsApp disconnected, the rest were not sent`);
      else if (latest.status === 'FAILED' || latest.failed > 0) toast.warning(message);
      else toast.success(message);
      watching.current = null;
    }
  }, [active, latest]);

  return query;
}

/** Read-only preview (who gets a slip, who is skipped and why, who was already sent). Fetched when the dialog opens. */
export function useSlipPreview(periodId: string | undefined, entryIds: string[] | undefined, enabled: boolean) {
  const key = entryIds ? [...entryIds].sort().join(',') : 'all';
  return useQuery({
    queryKey: queryKeys.payroll.slipPreview(periodId ?? '', key),
    queryFn: () => payrollApi.previewSlips(periodId as string, entryIds).then((r) => r.data),
    enabled: enabled && !!periodId,
    staleTime: 0,
    gcTime: 0,
  });
}

/** Queue the send. The request returns immediately; progress arrives through `useSlipStatus`. */
export function useSendSlips(periodId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<SendSlipsResult, { response?: { data?: { message?: unknown } } }, SendSlipsData>({
    retry: 0, // never auto-retry a send: a retry could message someone twice
    mutationFn: (data) => payrollApi.sendSlips(periodId as string, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.slipStatus(periodId ?? '') });
    },
    onError: (e) => {
      const msg = e?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Could not queue the salary slips.');
    },
  });
}

export function useSlipDispatchDetail(dispatchId: string | null) {
  return useQuery({
    queryKey: queryKeys.payroll.slipDispatch(dispatchId ?? ''),
    queryFn: () => payrollApi.getSlipDispatch(dispatchId as string).then((r) => r.data),
    enabled: !!dispatchId,
  });
}
