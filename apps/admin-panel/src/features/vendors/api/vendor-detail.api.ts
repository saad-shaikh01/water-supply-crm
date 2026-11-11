import { apiClient } from '@water-supply-crm/data-access';
import { unwrap } from '../../../lib/api';
import { clean } from './vendors.api';
import type {
  AuditLogRow,
  AuditQuery,
  BrandingDoc,
  BrandingImageKind,
  BrandingInput,
  BrandingView,
  Paginated,
  ProvisionResult,
  ReadinessView,
  ResetAdminPasswordBody,
  ResetAdminPasswordResult,
  VendorStatsResponse,
  VendorUsersQuery,
  VendorUsersResponse,
} from '../types';

export const vendorDetailApi = {
  getStats: (id: string) => unwrap<VendorStatsResponse>(apiClient.get(`/vendors/${id}/stats`)),
  getUsers: (id: string, params: VendorUsersQuery) =>
    unwrap<VendorUsersResponse>(apiClient.get(`/vendors/${id}/users`, { params: clean(params) })),
  provision: (id: string) => unwrap<ProvisionResult>(apiClient.post(`/vendors/${id}/provision`)),
  resetAdminPassword: (id: string, body: ResetAdminPasswordBody) =>
    unwrap<ResetAdminPasswordResult>(apiClient.post(`/vendors/${id}/reset-admin-password`, body)),

  getReadiness: (id: string) => unwrap<ReadinessView>(apiClient.get(`/vendors/${id}/readiness`)),
  goLive: (id: string, force = false) => unwrap<ReadinessView>(apiClient.post(`/vendors/${id}/go-live`, force ? { force: true } : {})),
  goOffline: (id: string, reason?: string) =>
    unwrap<ReadinessView>(apiClient.post(`/vendors/${id}/go-offline`, reason ? { reason } : {})),

  getBranding: (id: string) => unwrap<BrandingView>(apiClient.get(`/vendors/${id}/branding`)),
  saveBranding: (id: string, body: BrandingInput) => unwrap<BrandingView>(apiClient.put(`/vendors/${id}/branding`, body)),
  uploadBrandingImage: (id: string, kind: BrandingImageKind, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<BrandingView>(apiClient.post(`/vendors/${id}/branding/image/${kind}`, form));
  },
  deleteBrandingImage: (id: string, kind: BrandingImageKind) =>
    unwrap<BrandingView>(apiClient.delete(`/vendors/${id}/branding/image/${kind}`)),
  previewBranding: (id: string, doc: BrandingDoc, body: BrandingInput) =>
    unwrap<Blob>(apiClient.post(`/vendors/${id}/branding/preview`, body, { params: { doc }, responseType: 'blob' })),

  getAudit: (params: AuditQuery) => unwrap<Paginated<AuditLogRow>>(apiClient.get('/audit-logs', { params: clean(params) })),
};
