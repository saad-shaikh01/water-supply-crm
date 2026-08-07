import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CrewCashEntry } from '@water-supply-crm/types';
import { crewCashApi, type CreateCrewCashData, type UpdateCrewCashData } from '../api/crew-cash.api';
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
