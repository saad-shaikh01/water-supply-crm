import { apiClient } from '@water-supply-crm/data-access';
import type { Permission, PagePermission } from '@water-supply-crm/authz';
import type { LoginInput } from '../schemas';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  vendorId: string;
}

/** `/auth/me` response — identity plus the caller's effective RBAC grants. */
export interface AuthProfile extends AuthUser {
  roleId: string | null;
  permissions: Permission[];
  pagePermissions: PagePermission[];
}

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
}

export const authApi = {
  login: (data: LoginInput) =>
    apiClient.post<LoginResponse>('/auth/login', data),
  me: () => apiClient.get<AuthProfile>('/auth/me'),
  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) =>
    apiClient.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    apiClient.post('/auth/reset-password', { token, password }),
};
