import { apiClient } from '@water-supply-crm/data-access';

export interface NotificationLogFilters {
  channel?: string;
  status?: string;
  eventType?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  vanId?: string;
  dailySheetId?: string;
  sheetDate?: string;
  customerId?: string;
  errorCategory?: string;
}

const toParams = (filters?: NotificationLogFilters) => ({
  channel: filters?.channel || undefined,
  status: filters?.status || undefined,
  eventType: filters?.eventType || undefined,
  search: filters?.search || undefined,
  dateFrom: filters?.dateFrom || undefined,
  dateTo: filters?.dateTo || undefined,
  vanId: filters?.vanId || undefined,
  dailySheetId: filters?.dailySheetId || undefined,
  sheetDate: filters?.sheetDate || undefined,
  customerId: filters?.customerId || undefined,
  errorCategory: filters?.errorCategory || undefined,
});

export const notificationLogsApi = {
  getLogs: (page = 1, limit = 20, filters?: NotificationLogFilters) =>
    apiClient.get('/notifications/logs', { params: { page, limit, ...toParams(filters) } }),
  getSummary: (filters?: NotificationLogFilters) =>
    apiClient.get('/notifications/logs/summary', { params: toParams(filters) }),
  getLogById: (id: string) => apiClient.get(`/notifications/logs/${id}`),
  retry: (id: string) => apiClient.post(`/notifications/logs/${id}/retry`),
};
