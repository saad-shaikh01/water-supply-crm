import { apiClient } from '@water-supply-crm/data-access';

export const balanceRemindersApi = {
  getSchedule: () => apiClient.get('/balance-reminders/schedule'),
  setSchedule: (data: Record<string, unknown>) => apiClient.post('/balance-reminders/schedule', data),
  deleteSchedule: () => apiClient.delete('/balance-reminders/schedule'),
  sendNow: (data?: Record<string, unknown>) => apiClient.post('/balance-reminders/send-now', data ?? {}),
};
