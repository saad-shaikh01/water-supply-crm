import { apiClient } from '@water-supply-crm/data-access';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; name: string; email: string; role: string; customerId?: string };
}

interface EligibilityResponse {
  eligible: boolean;
  reason?: string;
  alreadyActivated?: boolean;
  customerName?: string;
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
  checkEligibility: (data: { customerCode: string; phoneNumber: string }) =>
    apiClient.post<EligibilityResponse>('/customer-activation/check-eligibility', data),
  activate: (data: { customerCode: string; phoneNumber: string; password: string }) =>
    apiClient.post<LoginResponse>('/customer-activation/activate', data),
  resetPasswordWithCode: (data: { customerCode: string; phoneNumber: string; password: string }) =>
    apiClient.post<LoginResponse>('/customer-activation/reset-password', data),
};
