import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import {
  vanCashLedgerApi,
  type CashLedgerStatsQuery,
  type CashLedgerTimelineQuery,
  type PendingHandoverQuery,
  type AddCashInPayload,
  type ApproveHandoverPayload,
  type CreateRemittancePayload,
  type ApproveRemittancePayload,
  type VoidRemittancePayload,
  type CorrectRemittancePayload,
  type EditManualCashInPayload,
  type VoidManualCashInPayload,
} from '../api/van-cash-ledger.api';
import { rangeThisMonth } from '../../../lib/date-pkt';
import { useCashLedgerFilters } from './use-cash-ledger-filters';

const QUERY_KEY = 'van-cash-ledger';

/**
 * The single source of truth for the Cash Ledger's date window. When the URL
 * carries neither `from` nor `to` the ledger defaults to "This Month" (first
 * day of the PKT month -> PKT today) — the SAME range the DateRangePicker's
 * `defaultPreset="This Month"` shows, since both come from `rangeThisMonth`.
 * If either bound is present the URL wins verbatim.
 */
export function resolveCashLedgerRange(
  from: string | null | undefined,
  to: string | null | undefined,
): { from?: string; to?: string } {
  if (!from && !to) return rangeThisMonth();
  return { from: from || undefined, to: to || undefined };
}

export const useCashLedgerTimeline = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const range = resolveCashLedgerRange(from, to);
  const params: CashLedgerTimelineQuery = {
    page,
    limit,
    vanId: vanId || undefined,
    from: range.from,
    to: range.to,
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

  const range = resolveCashLedgerRange(from, to);
  const params: CashLedgerStatsQuery = {
    vanId: vanId || undefined,
    from: range.from,
    to: range.to,
  };

  return useQuery({
    queryKey: [QUERY_KEY, 'stats', params],
    queryFn: () => vanCashLedgerApi.getStats(params).then((r) => r.data),
  });
};

/** Reconciliation statement + memo for the selected range/van (P1 summary strip and mini-bar). */
export const useCashLedgerSummary = () => {
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const range = resolveCashLedgerRange(from, to);
  const params: CashLedgerStatsQuery = {
    vanId: vanId || undefined,
    from: range.from,
    to: range.to,
  };

  return {
    ...useQuery({
      queryKey: [QUERY_KEY, 'summary', params],
      queryFn: () => vanCashLedgerApi.getSummary(params).then((r) => r.data),
      placeholderData: keepPreviousData,
    }),
    vanId,
    range,
  };
};

export const TIMELINE_PAGE_SIZE = 50;

/**
 * "Load more" timeline (P1): pages of TIMELINE_PAGE_SIZE rows appended in order.
 * Day totals come from `meta.dayStatements` (whole-day figures), so a business
 * day split across two loads still shows correct numbers. Page state lives in
 * react-query, NOT the URL.
 */
export const useInfiniteCashLedgerTimeline = () => {
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  // P3 entry filters (URL state) — part of the query key, so any change refetches from page 1.
  // They narrow the rows only, never the running balance or the day statements.
  const { filters } = useCashLedgerFilters();

  const range = resolveCashLedgerRange(from, to);
  const base = { limit: TIMELINE_PAGE_SIZE, vanId: vanId || undefined, from: range.from, to: range.to, ...filters };

  return useInfiniteQuery({
    queryKey: [QUERY_KEY, 'timeline-infinite', base],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      vanCashLedgerApi.getTimeline({ ...base, page: pageParam }).then((r) => r.data),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
};

/** Lazy Sheet Cash Breakdown (Collected − Expenses − Crew Cash = Net) for one sheet. */
export const useSheetCashBreakdown = (dailySheetId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: [QUERY_KEY, 'sheet-breakdown', dailySheetId],
    queryFn: () => vanCashLedgerApi.getSheetCashBreakdown(dailySheetId as string).then((r) => r.data),
    enabled: enabled && !!dailySheetId,
  });

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

export const useAddCashIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddCashInPayload) => vanCashLedgerApi.addCashIn(data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Cash in recorded');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to record cash in'),
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

// ── P2: edit / void / history ───────────────────────────────────────────────

export const useEditManualCashIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: EditManualCashInPayload }) =>
      vanCashLedgerApi.editManualCashIn(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Cash in updated');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to update cash in'),
  });
};

export const useVoidManualCashIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: VoidManualCashInPayload }) =>
      vanCashLedgerApi.voidManualCashIn(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Cash in entry deleted');
    },
    onError: (e: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e?.response?.data?.message ?? 'Failed to delete cash in entry'),
  });
};

/** Unified per-entry history (created / edited / approved / corrected / voided). Lazy — pass `enabled` when the drawer opens. */
export const useEntryHistory = (
  sourceType: string | null | undefined,
  sourceRecordId: string | null | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: [QUERY_KEY, 'entry-history', sourceType, sourceRecordId],
    queryFn: () => vanCashLedgerApi.getEntryHistory(sourceType as string, sourceRecordId as string).then((r) => r.data),
    enabled: enabled && !!sourceType && !!sourceRecordId,
  });
