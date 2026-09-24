import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  payrollApi,
  type AttendanceRecord,
  type AttendanceSearchQuery,
  type AttendanceSearchResult,
  type CreateAttendanceCategoryData,
  type MarkAttendanceData,
} from '../api/payroll.api';
import type { AttendanceCategory } from '@water-supply-crm/types';
import { queryKeys } from '../../../lib/query-keys';

/**
 * Staff Attendance — Phase 2 UI data layer. Mirrors the payroll feature's
 * existing hook conventions: every query takes an `enabled` boolean (permission
 * gate), mutations invalidate the affected keys and toast in `onSuccess` /
 * `onError`. Self-view of one's own attendance needs no permission (server-side
 * scope), so `useAttendanceByEmployee` gates only on id presence.
 */

export const useAttendanceByPeriod = (periodId: string | undefined, enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.payroll.attendanceByPeriod(periodId ?? ''),
    queryFn: (): Promise<AttendanceRecord[]> =>
      payrollApi.getAttendanceForPeriod(periodId as string).then((r) => r.data),
    enabled: enabled && !!periodId,
  });
};

export const useAttendanceByEmployee = (userId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.payroll.attendanceByEmployee(userId ?? ''),
    queryFn: (): Promise<AttendanceRecord[]> =>
      payrollApi.getAttendanceForEmployee(userId as string).then((r) => r.data),
    enabled: !!userId,
  });
};

export const useMarkAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MarkAttendanceData) => payrollApi.markAttendance(data),
    onSuccess: (_res, variables) => {
      // Prefix-invalidate every cached period grid (periodId isn't in `variables`).
      queryClient.invalidateQueries({ queryKey: ['payroll', 'attendance-period'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.attendanceByEmployee(variables.userId) });
      toast.success('Attendance recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record attendance'),
  });
};

/**
 * Refresh button: re-captures attendance for already-confirmed sheets that
 * never got their rows written (see `StaffAttendanceService.backfillForPeriod`).
 */
export const useBackfillAttendance = (periodId: string | undefined) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => payrollApi.backfillAttendance(periodId as string),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.attendanceByPeriod(periodId ?? '') });
      const { created, sheetsTouched } = res.data;
      toast.success(
        created > 0
          ? `Refreshed — ${created} attendance row${created === 1 ? '' : 's'} added from ${sheetsTouched} sheet${sheetsTouched === 1 ? '' : 's'}.`
          : 'Refreshed — already up to date.',
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to refresh attendance'),
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries a single call when the API's global per-IP rate limit (the "short"
 * throttler bucket — 10 requests/second, see `libs/shared/rate-limiting`)
 * rejects it with 429. Without this, a bulk action that fires more than ~10
 * calls in under a second has most of them bounce, and the grid's "Marked X
 * of Y — Z failed" toast just tells the admin to click the button again and
 * again until the remainder trickles through. Non-429 errors (real
 * validation failures) are never retried.
 */
async function callWithRetry(worker: () => Promise<unknown>, maxRetries = 4): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await worker();
    } catch (err: any) {
      if (err?.response?.status !== 429 || attempt >= maxRetries) throw err;
      const retryAfterSec = Number(err?.response?.headers?.['retry-after']);
      await sleep(Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 1200 * (attempt + 1));
    }
  }
}

/**
 * Runs `worker` over `items` in fixed-size batches with a pause between each
 * batch, instead of an always-full concurrency pool — the pool refills a
 * finished slot immediately, which for a large batch of fast local calls can
 * burst well past the 10-req/second short throttler bucket. A paced batch of
 * `batchSize` stays under that bucket by construction; `callWithRetry` is
 * still the backstop for whatever slips through.
 */
async function runInPacedBatches<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  worker: (item: T) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map((item) => callWithRetry(() => worker(item))));
    results.push(...settled);
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

export interface BulkMarkResult {
  total: number;
  succeeded: number;
  failed: number;
}

/**
 * Bulk-marks a batch of (userId, date) cells via the same single-cell
 * `POST /payroll/attendance/mark` endpoint — no dedicated bulk route, so this
 * fans the calls out client-side (bounded concurrency) and reports one
 * summary toast instead of one per cell. Used for "mark all empty cells
 * absent" and "mark a whole day off".
 */
export const useBulkMarkAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: MarkAttendanceData[]): Promise<BulkMarkResult> => {
      const results = await runInPacedBatches(items, 8, 1100, (data) => payrollApi.markAttendance(data));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: items.length, succeeded: items.length - failed, failed };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'attendance-period'] });
      if (result.total === 0) return;
      if (result.failed === 0) {
        toast.success(`Marked ${result.succeeded} day${result.succeeded === 1 ? '' : 's'}`);
      } else {
        toast.warning(
          `Marked ${result.succeeded} of ${result.total} day${result.total === 1 ? '' : 's'} — ${result.failed} failed.`,
        );
      }
    },
    onError: () => toast.error('Bulk attendance update failed'),
  });
};

// ── Attendance categories — the required reason field on a manual PRESENT
// marking (e.g. "office — other business"). Vendor-managed, no built-ins. ──

export const useAttendanceCategories = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.payroll.attendanceCategories(),
    queryFn: (): Promise<AttendanceCategory[]> => payrollApi.getAttendanceCategories().then((r) => r.data),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

export const useCreateAttendanceCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAttendanceCategoryData): Promise<AttendanceCategory> =>
      payrollApi.createAttendanceCategory(data).then((r) => r.data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.attendanceCategories() });
      toast.success(`Category "${created.name}" added`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add category'),
  });
};

/**
 * Vendor-wide, cross-period attendance filter (category / employee / status
 * within a date range) — the "which employees were in category X on which
 * dates" report, independent of the payroll-period grid. `enabled` should
 * gate on the caller having picked a date range (and, ideally, on an
 * explicit "Search" click rather than re-querying on every keystroke).
 */
export const useAttendanceSearch = (params: AttendanceSearchQuery | undefined, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.payroll.attendanceSearch(params ?? {}),
    queryFn: (): Promise<AttendanceSearchResult> => payrollApi.searchAttendance(params as AttendanceSearchQuery).then((r) => r.data),
    enabled: enabled && !!params,
  });

export const useDeleteAttendanceCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => payrollApi.deleteAttendanceCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll.attendanceCategories() });
      toast.success('Category removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove category'),
  });
};
