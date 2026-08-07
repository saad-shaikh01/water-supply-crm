import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Settlement } from '@water-supply-crm/types';
import { payrollApi, type RecordSettlementData } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/** `GET /payroll/entries/:id/settlements` response shape — `remainingBalance` may be negative if overpaid. */
export interface EntrySettlements {
  settlements: Settlement[];
  remainingBalance: number;
}

function invalidateEntry(queryClient: ReturnType<typeof useQueryClient>, entryId: string, periodId?: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.payroll.entrySettlements(entryId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.payroll.entryBreakdown(entryId) });
  if (periodId) queryClient.invalidateQueries({ queryKey: queryKeys.payroll.periodEntries(periodId) });
}

/**
 * All settlements recorded against one PayrollEntry, plus the server-computed
 * `remainingBalance` (`finalPayable - sum(settlements)`) — the base the Settlement
 * dialog's live remaining-balance figure is derived from as the user types (§7).
 */
export const useEntrySettlements = (entryId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.payroll.entrySettlements(entryId ?? ''),
    queryFn: (): Promise<EntrySettlements> => payrollApi.getSettlementsForEntry(entryId as string).then((r) => r.data),
    enabled: !!entryId,
  });
};

/**
 * Records one payment (full, partial, or over-payment — the backend never blocks
 * on the remaining balance, see `RecordSettlementDto`/`SettlementService.record`)
 * against a LOCKED or SETTLED entry. Auto-transitions the entry to SETTLED
 * server-side once the cumulative sum reaches `finalPayable`.
 */
export const useRecordSettlement = (entryId: string | undefined, periodId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RecordSettlementData) => payrollApi.recordSettlement(entryId as string, data),
    onSuccess: () => {
      if (entryId) invalidateEntry(queryClient, entryId, periodId);
      toast.success('Settlement recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record settlement'),
  });
};

/**
 * Explicitly closes out a LOCKED entry as SETTLED without requiring the sum of its
 * settlements to reach `finalPayable` — covers `finalPayable <= 0` and "close enough,
 * let the rest carry forward" (§5).
 */
export const useMarkSettled = (entryId: string | undefined, periodId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => payrollApi.markSettled(entryId as string, version),
    onSuccess: () => {
      if (entryId) invalidateEntry(queryClient, entryId, periodId);
      toast.success('Payroll entry marked settled');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to mark entry settled'),
  });
};
