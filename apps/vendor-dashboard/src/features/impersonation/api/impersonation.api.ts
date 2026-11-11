import { apiClient } from '@water-supply-crm/data-access';

export interface ImpersonationInfo {
  sessionId: string;
  actorName: string;
  actorId?: string;
  mode: 'READ_ONLY' | 'SUPPORT';
  expiresAt?: string;
}

export interface ExchangeResponse {
  access_token: string;
  expires_in: number;
  user: { id: string; email: string; name: string; role: string; vendorId: string };
  impersonation: ImpersonationInfo;
}

export const impersonationApi = {
  exchange: (code: string) => apiClient.post<ExchangeResponse>('/auth/impersonation/exchange', { code }),
  exit: () => apiClient.post<{ ok: boolean }>('/auth/impersonation/exit'),
};
