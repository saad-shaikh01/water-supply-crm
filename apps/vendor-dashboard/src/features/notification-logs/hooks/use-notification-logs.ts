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
  /** Of the sent WhatsApp rows: what Meta reported afterwards. PENDING = accepted, no delivery report. */
  byDelivery: Record<'DELIVERED' | 'READ' | 'FAILED' | 'PENDING', number>;
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

export interface BulkRetryPreview {
  matching: number;
  /** Failed and provably never delivered (upload / network) — retried by default. */
  retryable: number;
  /** Failed before failures were classified — only retried when the user opts in. */
  legacy: number;
  skipped: { permanent: number; disabled: number; alreadyDelivered: number; duplicate: number };
  capped: boolean;
}

export const useBulkRetryPreview = (filters: NotificationLogFilters | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['notification-logs-bulk-retry-preview', filters ?? {}],
    queryFn: () => notificationLogsApi.previewRetryFailed(filters).then((r) => r.data as BulkRetryPreview),
    enabled,
    // A dry run must always reflect the rows as they are right now.
    staleTime: 0,
    gcTime: 0,
  });

export const useBulkRetry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filters, includeLegacy }: { filters: NotificationLogFilters | undefined; includeLegacy: boolean }) =>
      notificationLogsApi.retryFailed(filters, includeLegacy).then((r) => r.data as { queued: number; failedToQueue: number }),
    onSuccess: (res) => {
      if (res.queued > 0) {
        toast.success(`Re-queued ${res.queued} message${res.queued === 1 ? '' : 's'} — results appear on each row as they are processed`);
      } else {
        toast.info('Nothing was re-queued');
      }
      if (res.failedToQueue > 0) toast.error(`${res.failedToQueue} could not be queued — try again`);
      qc.invalidateQueries({ queryKey: ['notification-logs'] });
      qc.invalidateQueries({ queryKey: ['notification-logs-summary'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not retry the failed sends'),
  });
};
