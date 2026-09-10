import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import {
  vanCashLedgerApi,
  type CashLedgerStatsQuery,
  type CashLedgerTimelineQuery,
  type PendingHandoverQuery,
  type SetOpeningBalancePayload,
  type ApproveHandoverPayload,
  type CreateRemittancePayload,
  type ApproveRemittancePayload,
  type VoidRemittancePayload,
  type CorrectRemittancePayload,
} from '../api/van-cash-ledger.api';

const QUERY_KEY = 'van-cash-ledger';

export const useCashLedgerTimeline = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: CashLedgerTimelineQuery = {
    page,
    limit,
    vanId: vanId || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  return {
    ...useQuery({
      queryKey: [QUERY_KEY, 'timeline', params],
      queryFn: () => vanCashLedgerApi.getTimeline(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    vanId,
    from,
    to,
  };
};

export const useCashLedgerStats = () => {
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: CashLedgerStatsQuery = {
    vanId: vanId || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  return useQuery({
    queryKey: [QUERY_KEY, 'stats', params],
    queryFn: () => vanCashLedgerApi.getStats(params).then((r) => r.data),
  });
};

export const usePendingHandovers = (params?: PendingHandoverQuery) =>
  useQuery({
    queryKey: [QUERY_KEY, 'pending-handovers', params ?? {}],
    queryFn: () => vanCashLedgerApi.getPendingHandovers(params).then((r) => r.data),
  });

export const usePendingRemittances = () =>
  useQuery({
    queryKey: [QUERY_KEY, 'pending-remittances'],
    queryFn: () => vanCashLedgerApi.getPendingRemittances().then((r) => r.data),
  });

const INVALIDATE_ALL = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
};

export const useSetOpeningBalance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SetOpeningBalancePayload) => vanCashLedgerApi.setOpeningBalance(data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Opening balance set');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to set opening balance'),
  });
};

export const useApproveHandover = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: ApproveHandoverPayload }) =>
      vanCashLedgerApi.approveHandover(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Handover approved');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to approve handover'),
  });
};

// ── Office Cash Remittance ──────────────────────────────────────────────────

export const useCreateRemittance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRemittancePayload) => vanCashLedgerApi.createRemittance(data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Owner handover recorded — pending approval');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to record owner handover'),
  });
};

export const useApproveRemittance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: ApproveRemittancePayload }) =>
      vanCashLedgerApi.approveRemittance(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Owner handover approved');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to approve owner handover'),
  });
};

export const useVoidRemittance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: VoidRemittancePayload }) =>
      vanCashLedgerApi.voidRemittance(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Owner handover voided');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to void owner handover'),
  });
};

export const useCorrectRemittance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: CorrectRemittancePayload }) =>
      vanCashLedgerApi.correctRemittance(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Correction submitted — pending approval');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to submit correction'),
  });
};
