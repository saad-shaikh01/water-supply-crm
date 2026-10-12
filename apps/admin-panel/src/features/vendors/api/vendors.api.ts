import { apiClient } from '@water-supply-crm/data-access';

export interface VendorQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export const vendorsApi = {
  getAll: (params: VendorQuery) => apiClient.get('/vendors', { params }),
  getOne: (id: string) => apiClient.get(`/vendors/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/vendors', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vendors/${id}`, data),
  remove: (id: string) => apiClient.delete(`/vendors/${id}`),
};

export interface WipeBlocker {
  code: 'WIPE_DISABLED' | 'PROTECTED_VENDOR' | 'NOT_SUSPENDED';
  message: string;
}

export interface WipePreview {
  vendor: { id: string; name: string; slug: string; isActive: boolean };
  allowed: boolean;
  blockers: WipeBlocker[];
  tables: { model: string; rows: number }[];
  totalRows: number;
  keeps: string[];
  previewToken: string;
}

export interface WipeInput {
  id: string;
  confirmSlug: string;
  password: string;
  acknowledgeBackup: boolean;
  previewToken: string;
}

export const vendorWipeApi = {
  suspend: (id: string) => apiClient.patch(`/vendors/${id}/suspend`),
  unsuspend: (id: string) => apiClient.patch(`/vendors/${id}/unsuspend`),
  preview: (id: string) => apiClient.get<WipePreview>(`/vendors/${id}/wipe/preview`).then((r) => r.data),
  wipe: ({ id, ...body }: WipeInput) =>
    // A large vendor can take a while; do not let the default client timeout abort a wipe that is still running server-side.
    apiClient.post<{ message: string; totalRows: number }>(`/vendors/${id}/wipe`, body, { timeout: 15 * 60_000 }).then((r) => r.data),
};
