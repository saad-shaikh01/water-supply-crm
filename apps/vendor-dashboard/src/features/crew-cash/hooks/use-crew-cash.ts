import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CrewCashEntry } from '@water-supply-crm/types';
import {
  crewCashApi,
  type CreateCrewCashData,
  type UpdateCrewCashData,
  type CorrectCrewCashData,
  type CreateStandaloneCrewCashData,
  type UpdateStandaloneCrewCashData,
} from '../api/crew-cash.api';
import { queryKeys } from '../../../lib/query-keys';

export const useCrewCashForSheet = (sheetId: string) => {
  return useQuery({
    queryKey: queryKeys.crewCash.forSheet(sheetId),
    queryFn: (): Promise<CrewCashEntry[]> => crewCashApi.getForSheet(sheetId).then((r) => r.data),
    enabled: !!sheetId,
  });
};

export const useCreateCrewCash = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCrewCashData) => crewCashApi.create(sheetId, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crewCash.forSheet(sheetId) });
      // Flag-not-block (doc §14): a repeat same sheet+employee+category+amount within
      // 5 minutes is never rejected, only surfaced — the entry is already recorded.
      const possibleDuplicate = (res.data as CrewCashEntry & { possibleDuplicate?: boolean }).possibleDuplicate;
      if (possibleDuplicate) {
        toast.warning('Crew cash recorded — looks like a repeat of a recent entry.');
      } else {
        toast.success('Crew cash recorded');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record crew cash'),
  });
};

export const useUpdateCrewCash = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCrewCashData }) => crewCashApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crewCash.forSheet(sheetId) });
      toast.success('Crew cash entry updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update entry'),
  });
};

/**
 * Post-close correction of an already-synced crew-cash row. Reverses the linked
 * Staff Ledger entry, posts a fresh one and rewrites the row — gated the same
 * as editing a closed sheet's expenses (`daily_sheets:edit_closed_expense`).
 * Also refreshes the sheet detail so the post-close divergence banner updates.
 */
export const useCorrectCrewCash = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CorrectCrewCashData }) =>
      crewCashApi.correct(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crewCash.forSheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Crew cash correction applied');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to apply correction'),
  });
};

export const useDeleteCrewCash = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => crewCashApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crewCash.forSheet(sheetId) });
      toast.success('Crew cash entry deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete entry'),
  });
};

/**
 * Crew Cash recorded WITHOUT a Daily Sheet (owner-requested 2026-09-18) — a
 * vendor-wide cash-out tier (see StandaloneCrewCashExpense in schema.prisma),
 * same as a Fuel Card top-up. Invalidates the `van-cash-ledger` namespace
 * (not `crewCash.forSheet`, since this has no sheet) so the Cash Ledger
 * page's timeline/balance/stats refresh immediately.
 */
export const useCreateStandaloneCrewCash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStandaloneCrewCashData) => crewCashApi.createStandalone(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Crew cash recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record crew cash'),
  });
};

export const useVoidStandaloneCrewCash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => crewCashApi.voidStandalone(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Crew cash entry voided');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to void entry'),
  });
};

/** Edit a standalone crew-cash entry in place (P2) — refreshes the whole Cash Ledger namespace. */
export const useUpdateStandaloneCrewCash = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: UpdateStandaloneCrewCashData }) =>
      crewCashApi.updateStandalone(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Crew cash entry updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update entry'),
  });
};
