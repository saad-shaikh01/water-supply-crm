import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  payrollApi,
  type AttendanceRecord,
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

/** Bounded-concurrency runner — avoids firing 50+ simultaneous requests for a large grid. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = new Array(items.length);
  let cursor = 0;
  async function runNext(): Promise<void> {
    const current = cursor++;
    if (current >= items.length) return;
    try {
      const value = await worker(items[current]);
      results[current] = { status: 'fulfilled', value };
    } catch (reason) {
      results[current] = { status: 'rejected', reason };
    }
    return runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
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
      const results = await runWithConcurrency(items, 8, (data) => payrollApi.markAttendance(data));
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
