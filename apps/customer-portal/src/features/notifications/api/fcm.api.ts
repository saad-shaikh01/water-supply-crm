import { apiClient } from '@water-supply-crm/data-access';

export const fcmApi = {
  registerToken: (token: string) =>
    apiClient.post('/fcm/token', { token, platform: 'web' }),

  deleteToken: (token: string) =>
    apiClient.delete('/fcm/token', { data: { token } }),
};
