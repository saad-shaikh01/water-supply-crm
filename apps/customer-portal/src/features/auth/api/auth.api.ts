import { apiClient } from '@water-supply-crm/data-access';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; name: string; email: string; role: string; customerId?: string };
}

export const authApi = {
  login: (data: { identifier: string; password: string }) =>
    apiClient.post<LoginResponse>('/auth/login', data),
  me: () =>
    apiClient.get<{ id: string; name: string; email: string; customerId: string }>('/auth/me'),
  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),
  forgotPassword: (data: { email: string }) =>
    apiClient.post('/auth/forgot-password', data),
  resetPassword: (data: { token: string; newPassword: string }) =>
    apiClient.post('/auth/reset-password', data),
};
