import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PayrollEntry, PayrollPeriod, StaffLedgerEntry } from '@water-supply-crm/types';
import { payrollApi } from '../api/payroll.api';
import { queryKeys } from '../../../lib/query-keys';

/** The seven bucket columns a PayrollEntry's ledger contribution is split into. */
export interface PayrollEntryBucketTotals {
  bonuses: number;
  overtime: number;
  incentives: number;
  advances: number;
  expenses: number;
  penalties: number;
  otherDeductions: number;
}

/** `GET /payroll/entries/:id/breakdown` — the full entry plus its bucket-grouped ledger entries. */
export interface PayrollEntryBreakdown {
  entry: PayrollEntry & { period: PayrollPeriod };
  ledgerEntriesByBucket: Record<keyof PayrollEntryBucketTotals, StaffLedgerEntry[]>;
}

/**
 * Full itemized breakdown for one entry — self-view for everyone, `payroll:view_all`
 * required to view another employee's (enforced server-side; this hook doesn't
 * duplicate that check). Used by the row-click Dialog on the Monthly Payroll page,
 * matching this codebase's "DataTable has no renderExpanded — use a Dialog" convention.
 */
export const useEntryBreakdown = (entryId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.payroll.entryBreakdown(entryId ?? ''),
    queryFn: (): Promise<PayrollEntryBreakdown> => payrollApi.getEntryBreakdown(entryId as string).then((r) => r.data),
    enabled: !!entryId,
  });
};

function invalidatePeriod(queryClient: ReturnType<typeof useQueryClient>, periodId: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.payroll.periodEntries(periodId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.payroll.openPeriod() });
}

/** `POST /payroll/periods/:periodId/entries/generate`'s response shape (doc §5 edge case: employees
 * missing a Salary Structure are excluded with a visible warning, never silently defaulted to ₨0). */
export interface GenerateDraftResult {
  periodId: string;
  generated: number;
  regenerated: number;
  skippedMissingSalaryStructure: Array<{ userId: string; name: string }>;
  skippedDataError: Array<{ userId: string; name: string; reason: string }>;
  skippedAlreadyReviewed: Array<{ userId: string; name: string; status: string }>;
}

/**
 * Computes/upserts one PayrollEntry per eligible employee — idempotent per the doc
 * (§9 step 7: "safe to regenerate repeatedly while still DRAFT"); already-APPROVED
 * entries are skipped server-side, no client-side guard needed beyond the in-flight
 * disable the caller already applies to the button. Callers that need to react to
 * `skippedMissingSalaryStructure` (e.g. to surface a "Set Salary" banner) can pass
 * their own `onSuccess` into `mutate()` — it fires alongside this hook's own.
 */
export const useGenerateDraft = (periodId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<GenerateDraftResult> => payrollApi.generateDraft(periodId as string).then((r) => r.data),
    onSuccess: (result) => {
      if (periodId) invalidatePeriod(queryClient, periodId);
      const skipped = result.skippedMissingSalaryStructure.length;
      if (skipped > 0) {
        toast.warning(`Payroll draft generated — ${skipped} employee${skipped === 1 ? '' : 's'} skipped (missing salary structure).`);
      } else {
        toast.success('Payroll draft generated');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to generate payroll draft'),
  });
};

/** DRAFT -> APPROVED, per row. Optimistic-concurrency `version` must match the entry's current version. */
export const useApproveEntry = (periodId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => payrollApi.approveEntry(id, version),
    onSuccess: () => {
      if (periodId) invalidatePeriod(queryClient, periodId);
      toast.success('Payroll entry approved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to approve payroll entry'),
  });
};

/**
 * Period-wide, one-way gate into Settlement (§9 step 9) — rejects with the names of
 * any not-yet-APPROVED entries; that message is surfaced to the caller as-is rather
 * than re-derived client-side.
 */
export const useLockPeriod = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (periodId: string) => payrollApi.lockPeriod(periodId),
    onSuccess: (_res, periodId) => {
      invalidatePeriod(queryClient, periodId);
      toast.success('Payroll period locked');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to lock payroll period'),
  });
};

/** LOCKED -> REVIEW, VENDOR_ADMIN-only, mandatory reason logged to the audit trail. */
export const useUnlockPeriod = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId, reason }: { periodId: string; reason: string }) => payrollApi.unlockPeriod(periodId, reason),
    onSuccess: (_res, { periodId }) => {
      invalidatePeriod(queryClient, periodId);
      toast.success('Payroll period unlocked');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to unlock payroll period'),
  });
};
