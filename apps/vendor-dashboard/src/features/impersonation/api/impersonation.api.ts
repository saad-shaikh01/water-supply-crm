import axios from 'axios';
import { apiClient } from '@water-supply-crm/data-access';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

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
  // Plain axios on purpose: a spent/expired code answers 401, and apiClient's 401 handler would bounce the
  // browser to /auth/login instead of letting the exchange page show "invalid, expired or already used".
  exchange: (code: string) => axios.post<ExchangeResponse>(`${API_URL}/auth/impersonation/exchange`, { code }),
  exit: () => apiClient.post<{ ok: boolean }>('/auth/impersonation/exit'),
};
