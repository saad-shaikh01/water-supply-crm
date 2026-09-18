import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  vanCashLedgerApi,
  type ClosePeriodPayload,
  type ReopenPeriodPayload,
} from '../api/van-cash-ledger.api';

const QUERY_KEY = 'van-cash-ledger';

/** Accounting periods (newest first) + the caller's close/override permissions. Refreshed by any ledger mutation (same key namespace). */
export const useCashLedgerPeriods = () =>
  useQuery({
    queryKey: [QUERY_KEY, 'periods'],
    queryFn: () => vanCashLedgerApi.getPeriods().then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** The close checklist (blockers / warnings / statement to snapshot) — lazy, enable when the close dialog opens. */
export const usePeriodCloseCheck = (label: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: [QUERY_KEY, 'period-close-check', label],
    queryFn: () => vanCashLedgerApi.getPeriodCloseCheck(label as string).then((r) => r.data),
    enabled: enabled && !!label,
    // The checklist must be fresh every time the dialog opens.
    staleTime: 0,
    gcTime: 0,
  });

export const useClosePeriod = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ label, data }: { label: string; data: ClosePeriodPayload }) =>
      vanCashLedgerApi.closePeriod(label, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Period closed');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to close the period'),
  });
};

export const useReopenPeriod = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ label, data }: { label: string; data: ReopenPeriodPayload }) =>
      vanCashLedgerApi.reopenPeriod(label, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Period reopened');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to reopen the period'),
  });
};
