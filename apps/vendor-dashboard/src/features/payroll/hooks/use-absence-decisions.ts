import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { payrollApi, type ResolveAbsencesData } from '../api/payroll.api';

const ACTION_DONE: Record<ResolveAbsencesData['action'], string> = {
  UNPAID: 'marked unpaid',
  WAIVE: 'marked paid',
  RESET: 'reset to undecided',
};

/**
 * Bulk paid / unpaid / reset decision for one employee's Absent & Half-day days
 * (`POST /payroll/attendance/resolve-absences`). All-or-nothing server-side, so a
 * failure here means NOTHING changed - the message names the offending days.
 *
 * Invalidates every cached entry breakdown + period grid: the Attendance tab, the
 * "needs review" badge on the Monthly Payroll row and the "recent changes" banner
 * all read data this changes.
 */
export const useResolveAbsences = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ResolveAbsencesData) => payrollApi.resolveAbsences(data).then((r) => r.data),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      const parts = [`${result.affected} day${result.affected === 1 ? '' : 's'} ${ACTION_DONE[variables.action]}`];
      if (result.totalDeducted > 0) parts.push(`₨ ${result.totalDeducted.toLocaleString()} deducted`);
      if (result.unchanged > 0) parts.push(`${result.unchanged} already ${result.unchanged === 1 ? 'was' : 'were'} in that state`);
      toast.success(parts.join(' - '));
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update the selected days'),
  });
};
