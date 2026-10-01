import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sheetAdvancesApi, type CreateSheetAdvanceData, type UpdateSheetAdvanceData } from '../api/sheet-advances.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * Every mutation refreshes the sheet detail (the advances list, the cash-out totals, the
 * reconciliation figures and the post-close divergence banner all derive from it) and the
 * Cash Ledger namespace (a closed-sheet change corrects that sheet's handover).
 */
function useRefresh(sheetId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
    queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
  };
}

const errorMessage = (e: any, fallback: string) => e?.response?.data?.message ?? fallback;

export const useCreateSheetAdvance = (sheetId: string) => {
  const refresh = useRefresh(sheetId);
  return useMutation({
    mutationFn: (data: CreateSheetAdvanceData) => sheetAdvancesApi.create(sheetId, data),
    onSuccess: () => {
      refresh();
      toast.success('Advance recorded');
    },
    onError: (e: any) => toast.error(errorMessage(e, 'Failed to record advance')),
  });
};

export const useUpdateSheetAdvance = (sheetId: string) => {
  const refresh = useRefresh(sheetId);
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: UpdateSheetAdvanceData }) => sheetAdvancesApi.update(id, data),
    onSuccess: () => {
      refresh();
      toast.success('Advance updated');
    },
    onError: (e: any) => toast.error(errorMessage(e, 'Failed to update advance')),
  });
};

export const useDeleteSheetAdvance = (sheetId: string) => {
  const refresh = useRefresh(sheetId);
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => sheetAdvancesApi.remove(id, reason),
    onSuccess: () => {
      refresh();
      toast.success('Advance deleted');
    },
    onError: (e: any) => toast.error(errorMessage(e, 'Failed to delete advance')),
  });
};
