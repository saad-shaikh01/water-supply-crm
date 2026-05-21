import { apiClient } from '@water-supply-crm/data-access';

export const notificationPreferencesApi = {
  getAll: () => apiClient.get('/notifications/preferences'),

  upsert: (eventType: string, channel: string, enabled: boolean) =>
    apiClient.patch('/notifications/preferences', { eventType, channel, enabled }),
};
