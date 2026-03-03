import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { balanceRemindersApi, PreviewPayload, SendTargetedPayload } from '../api/balance-reminders.api';

const QUERY_KEY = ['balance-reminders-schedule'];

export const useReminderSchedule = () =>
  useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => balanceRemindersApi.getSchedule().then((r) => r.data),
  });

export const useSetReminderSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => balanceRemindersApi.setSchedule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Schedule saved');
    },
    onError: () => toast.error('Failed to save schedule'),
  });
};

export const useDeleteReminderSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => balanceRemindersApi.deleteSchedule(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Schedule removed');
    },
    onError: () => toast.error('Failed to remove schedule'),
  });
};

export const useSendRemindersNow = () => {
  return useMutation({
    mutationFn: (data?: Record<string, unknown>) => balanceRemindersApi.sendNow(data),
    onSuccess: (res) => {
      const data = (res as any).data;
      const count = data?.sent ?? data?.count ?? '?';
      toast.success(`Reminders sent to ${count} customers`);
    },
    onError: () => toast.error('Failed to send reminders'),
  });
};

export const useSendTargeted = () => {
  return useMutation({
    mutationFn: (payload: SendTargetedPayload) => balanceRemindersApi.sendTargeted(payload),
    onSuccess: (res) => {
      const data = (res as any).data;
      const count = data?.sent ?? 0;
      const month = data?.month ?? '';
      const withStatement = data?.includeStatement ? ' with statement' : '';
      toast.success(`Sent ${count} reminder${count !== 1 ? 's' : ''}${withStatement} for ${month}`);
    },
    onError: () => toast.error('Failed to send reminders'),
  });
};

export const usePreviewReminders = () => {
  return useMutation({
    mutationFn: (payload: PreviewPayload) => balanceRemindersApi.preview(payload),
    onError: () => toast.error('Failed to load preview'),
  });
};
