import { apiClient } from '@water-supply-crm/data-access';
import type { LoginInput } from '../schemas';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  vendorId: string;
}

export const authApi = {
  login: (data: LoginInput) =>
    apiClient.post<{ access_token: string; user: AuthUser }>('/auth/login', data),
  me: () => apiClient.get<AuthUser>('/auth/me'),
  forgotPassword: (email: string) =>
    apiClient.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    apiClient.post('/auth/reset-password', { token, password }),
};
