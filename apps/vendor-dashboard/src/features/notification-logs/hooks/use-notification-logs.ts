import { useQuery } from '@tanstack/react-query';
import { notificationLogsApi, NotificationLogFilters } from '../api/notification-logs.api';

export const useNotificationLogs = (page = 1, limit = 20, filters?: NotificationLogFilters) =>
  useQuery({
    queryKey: [
      'notification-logs',
      page,
      limit,
      filters?.channel ?? '',
      filters?.status ?? '',
      filters?.eventType ?? '',
      filters?.search ?? '',
      filters?.dateFrom ?? '',
      filters?.dateTo ?? '',
    ],
    queryFn: () => notificationLogsApi.getLogs(page, limit, filters).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

export const useNotificationLogDetail = (id: string | null) =>
  useQuery({
    queryKey: ['notification-log-detail', id],
    queryFn: () => notificationLogsApi.getLogById(id as string).then((r) => r.data),
    enabled: !!id,
  });
