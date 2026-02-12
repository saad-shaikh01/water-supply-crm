import { apiClient } from '@water-supply-crm/data-access';

export const authApi = {
  login: (data: { email: string; password: string }) =>
    apiClient.post<{ access_token: string; user: { id: string; name: string; email: string; customerId: string } }>('/auth/login', data),

  me: () =>
    apiClient.get<{ id: string; name: string; email: string; customerId: string }>('/auth/me'),
};
