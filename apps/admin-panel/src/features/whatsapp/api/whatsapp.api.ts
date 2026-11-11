import { apiClient, unwrap } from '../../../lib/api';

/**
 * Account shape consumed by the panel. Credentials never reach this layer: the API
 * exposes presentation fields only, and this type deliberately declares nothing else.
 */
export type WhatsAppStatus = 'NOT_CONFIGURED' | 'READY' | 'TOKEN_INVALID' | 'SUSPENDED';

export interface AssignedVendor {
  id: string;
  name: string;
  isActive: boolean;
}

export interface WhatsAppAccountRow {
  id: string;
  label: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  displayNumber: string | null;
  verifiedName: string | null;
  status: WhatsAppStatus;
  qualityRating: string | null;
  lastHealthCheckAt: string | null;
  lastHealthError: string | null;
  templateSuffix: string | null;
  templatesSyncedAt: string | null;
  vendors: AssignedVendor[];
}

export interface WhatsAppListResponse {
  data: WhatsAppAccountRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface WhatsAppQuery {
  status?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface AssignableVendor {
  id: string;
  name: string;
}

export const whatsappApi = {
  list: (params: WhatsAppQuery) => unwrap(apiClient.get<WhatsAppListResponse>('/platform/whatsapp-accounts', { params })),
  assignable: (q?: string) =>
    unwrap(apiClient.get<AssignableVendor[]>('/platform/whatsapp-accounts/assignable-vendors', { params: q ? { q } : undefined })),
  assign: (id: string, vendorId: string, replace?: boolean) =>
    unwrap(apiClient.post<WhatsAppAccountRow>(`/platform/whatsapp-accounts/${id}/assign`, { vendorId, ...(replace ? { replace: true } : {}) })),
  unassign: (id: string, vendorId: string) =>
    unwrap(apiClient.post<WhatsAppAccountRow>(`/platform/whatsapp-accounts/${id}/unassign`, { vendorId })),
  verify: (id: string) => unwrap(apiClient.post<WhatsAppAccountRow>(`/platform/whatsapp-accounts/${id}/verify`)),
};

/** True when assign failed because the vendor already has a different account. */
export function isVendorHasAccountError(e: unknown): boolean {
  const r = (e as { response?: { status?: number; data?: { code?: string } } })?.response;
  return r?.status === 409 && r?.data?.code === 'VENDOR_HAS_ACCOUNT';
}
