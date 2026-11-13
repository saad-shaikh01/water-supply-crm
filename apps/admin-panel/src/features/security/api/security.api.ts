import { apiClient, unwrap } from '../../../lib/api';
import type { TwoFactorSetup } from '../../auth/api/auth.api';

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface AdminSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const securityApi = {
  twoFactorStatus: () => unwrap(apiClient.get<TwoFactorStatus>('/admin/security/2fa')),
  setup: () => unwrap(apiClient.post<TwoFactorSetup>('/admin/security/2fa/setup')),
  confirm: (code: string) => unwrap(apiClient.post<{ recoveryCodes: string[] }>('/admin/security/2fa/confirm', { code })),
  regenerate: (code: string) =>
    unwrap(apiClient.post<{ recoveryCodes: string[] }>('/admin/security/2fa/recovery-codes/regenerate', { code })),
  disable: (password: string, code: string) =>
    unwrap(apiClient.post<{ message: string }>('/admin/security/2fa/disable', { password, code })),
  sessions: () => unwrap(apiClient.get<AdminSession[]>('/admin/security/sessions')),
  revokeSession: (id: string) => unwrap(apiClient.delete<{ message: string }>(`/admin/security/sessions/${id}`)),
  revokeOthers: () => unwrap(apiClient.post<{ revoked: number }>('/admin/security/sessions/revoke-others')),
};
