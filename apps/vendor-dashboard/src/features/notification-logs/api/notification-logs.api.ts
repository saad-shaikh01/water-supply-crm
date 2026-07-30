import { apiClient } from '@water-supply-crm/data-access';

export interface NotificationLogFilters {
  channel?: string;
  status?: string;
  eventType?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const notificationLogsApi = {
  getLogs: (page = 1, limit = 20, filters?: NotificationLogFilters) =>
    apiClient.get('/notifications/logs', {
      params: {
        page,
        limit,
        channel: filters?.channel || undefined,
        status: filters?.status || undefined,
        eventType: filters?.eventType || undefined,
        search: filters?.search || undefined,
        dateFrom: filters?.dateFrom || undefined,
        dateTo: filters?.dateTo || undefined,
      },
    }),
  getLogById: (id: string) => apiClient.get(`/notifications/logs/${id}`),
};
