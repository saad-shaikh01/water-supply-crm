import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type AttendanceRecord, type MarkAttendanceData } from '../api/payroll.api';
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
