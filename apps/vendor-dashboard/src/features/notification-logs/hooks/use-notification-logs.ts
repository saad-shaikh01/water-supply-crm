import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { notificationLogsApi, NotificationLogFilters } from '../api/notification-logs.api';

export const useNotificationLogs = (page = 1, limit = 20, filters?: NotificationLogFilters) =>
  useQuery({
    queryKey: ['notification-logs', page, limit, filters ?? {}],
    queryFn: () => notificationLogsApi.getLogs(page, limit, filters).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

export interface NotificationLogSummary {
  total: number;
  byStatus: Record<'SENT' | 'FAILED' | 'SKIPPED', number>;
  byEventType: { eventType: string | null; count: number }[];
  byErrorCategory: Record<'DISABLED' | 'NOT_DELIVERED' | 'API_ERROR', number>;
}

export const useNotificationLogSummary = (filters?: NotificationLogFilters) =>
  useQuery({
    queryKey: ['notification-logs-summary', filters ?? {}],
    queryFn: () => notificationLogsApi.getSummary(filters).then((r) => r.data as NotificationLogSummary),
    placeholderData: (prev) => prev,
  });

export const useRetryNotificationLog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationLogsApi.retry(id),
    onSuccess: () => {
      toast.success('Re-queued — a new log row appears once it is processed');
      qc.invalidateQueries({ queryKey: ['notification-logs'] });
      qc.invalidateQueries({ queryKey: ['notification-logs-summary'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not retry this send'),
  });
};

export const useNotificationLogDetail = (id: string | null) =>
  useQuery({
    queryKey: ['notification-log-detail', id],
    queryFn: () => notificationLogsApi.getLogById(id as string).then((r) => r.data),
    enabled: !!id,
  });
