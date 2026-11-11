import { apiClient, unwrap } from '../../../lib/api';

export type ImpersonationMode = 'READ_ONLY' | 'SUPPORT';

/** Backend limits (StartImpersonationDto). Keep in sync. */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const TTL_OPTIONS = [15, 30, 60] as const;
export type TtlMinutes = (typeof TTL_OPTIONS)[number];

export interface StartImpersonationInput {
  vendorId: string;
  reason: string;
  mode: ImpersonationMode;
  ttlMinutes: TtlMinutes;
}

export interface StartImpersonationResult {
  sessionId: string;
  handoffUrl: string;
  expiresAt: string;
  target: { id: string; name: string; email: string };
}

export interface ImpersonationSession {
  id: string;
  actorId: string;
  actorName: string;
  vendorId: string;
  targetUserId: string;
  targetName: string;
  mode: ImpersonationMode;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: string | null;
  actionCount: number;
}

export interface ImpersonationListResult {
  data: ImpersonationSession[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

export const impersonationApi = {
  start: (body: StartImpersonationInput) => unwrap<StartImpersonationResult>(apiClient.post('/platform/impersonation', body)),
  list: (params: { vendorId?: string; active?: boolean; page?: number; limit?: number }) =>
    unwrap<ImpersonationListResult>(apiClient.get('/platform/impersonation', { params })),
  revoke: (id: string) => unwrap<ImpersonationSession>(apiClient.post(`/platform/impersonation/${id}/revoke`)),
};
