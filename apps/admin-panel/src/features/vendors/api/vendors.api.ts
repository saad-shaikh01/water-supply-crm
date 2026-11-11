import { apiClient } from '@water-supply-crm/data-access';
import { unwrap } from '../../../lib/api';
import type {
  BulkResult,
  CreateVendorInputBody,
  CreateVendorResult,
  Paginated,
  VendorListQuery,
  VendorRow,
} from '../types';

/** Drop empty filter values so they are never sent as `?search=&status=`. */
export const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;

export const vendorsApi = {
  getAll: (params: VendorListQuery) => unwrap<Paginated<VendorRow>>(apiClient.get('/vendors', { params: clean(params) })),
  getOne: (id: string) => unwrap<VendorRow>(apiClient.get(`/vendors/${id}`)),
  create: (data: CreateVendorInputBody) => unwrap<CreateVendorResult>(apiClient.post('/vendors', data)),
  update: (id: string, data: Record<string, unknown>) => unwrap<VendorRow>(apiClient.patch(`/vendors/${id}`, data)),
  remove: (id: string) => apiClient.delete(`/vendors/${id}`),
  suspend: (id: string, reason?: string) => apiClient.patch(`/vendors/${id}/suspend`, reason ? { reason } : {}),
  unsuspend: (id: string, reason?: string) => apiClient.patch(`/vendors/${id}/unsuspend`, reason ? { reason } : {}),
  bulkSuspend: (vendorIds: string[], reason?: string) =>
    unwrap<BulkResult>(apiClient.post('/vendors/bulk/suspend', reason ? { vendorIds, reason } : { vendorIds })),
  bulkUnsuspend: (vendorIds: string[], reason?: string) =>
    unwrap<BulkResult>(apiClient.post('/vendors/bulk/unsuspend', reason ? { vendorIds, reason } : { vendorIds })),
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
  preview: (id: string) => apiClient.get<WipePreview>(`/vendors/${id}/wipe/preview`).then((r) => r.data),
  wipe: ({ id, ...body }: WipeInput) =>
    // A large vendor can take a while; do not let the default client timeout abort a wipe that is still running server-side.
    apiClient.post<{ message: string; totalRows: number }>(`/vendors/${id}/wipe`, body, { timeout: 15 * 60_000 }).then((r) => r.data),
};
