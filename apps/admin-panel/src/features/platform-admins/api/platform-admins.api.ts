import { apiClient, unwrap } from '../../../lib/api';

export interface PlatformAdminRow {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  twoFactorEnabled: boolean;
  activeSessions: number;
}

export interface PlatformAdminList {
  data: PlatformAdminRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PlatformAdminQuery {
  search?: string;
  isActive?: string;
  page?: number;
  limit?: number;
}

export interface CreatePlatformAdminInput {
  name: string;
  email: string;
  password?: string;
}

export interface CreatePlatformAdminResult {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  /** Returned ONCE when no password was supplied. */
  tempPassword?: string;
}

export const platformAdminsApi = {
  list: (params: PlatformAdminQuery) => unwrap(apiClient.get<PlatformAdminList>('/platform-admins', { params })),
  create: (body: CreatePlatformAdminInput) => unwrap(apiClient.post<CreatePlatformAdminResult>('/platform-admins', body)),
  deactivate: (id: string, reason: string) => unwrap(apiClient.patch<{ id: string; isActive: false }>(`/platform-admins/${id}/deactivate`, { reason })),
  activate: (id: string) => unwrap(apiClient.patch<{ id: string; isActive: true }>(`/platform-admins/${id}/activate`)),
  resetPassword: (id: string, mode: 'EMAIL' | 'TEMP') =>
    unwrap(apiClient.post<{ id: string; message?: string; tempPassword?: string }>(`/platform-admins/${id}/reset-password`, { mode })),
  resetTwoFactor: (id: string, reason: string) => unwrap(apiClient.post<{ id: string; message: string }>(`/platform-admins/${id}/reset-2fa`, { reason })),
  unlock: (id: string) => unwrap(apiClient.post<{ id: string; message: string }>(`/platform-admins/${id}/unlock`)),
};
