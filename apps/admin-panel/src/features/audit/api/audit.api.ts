import { apiClient, unwrap } from '../../../lib/api';

export interface AuditChanges {
  before?: unknown;
  after?: unknown;
  reason?: string;
  [key: string]: unknown;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  vendorId: string | null;
  vendorName: string | null;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: AuditChanges | null;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditListResponse {
  data: AuditRow[];
  meta: PageMeta;
}

export interface AuditFacets {
  actions: string[];
  entities: string[];
}

export interface AuditQuery {
  vendorId?: string;
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface VendorOption {
  id: string;
  name: string;
}

export const auditApi = {
  list: (params: AuditQuery) => unwrap(apiClient.get<AuditListResponse>('/platform/audit-logs', { params })),
  facets: () => unwrap(apiClient.get<AuditFacets>('/platform/audit-logs/facets')),
  /** Server-built CSV for the active filters (page/limit are not part of an export). */
  exportCsv: async (params: AuditQuery) => {
    const res = await apiClient.get<Blob>('/platform/audit-logs/export.csv', { params, responseType: 'blob' });
    return { blob: res.data, truncated: String(res.headers?.['x-export-truncated']) === 'true' };
  },
  vendorOptions: async (): Promise<VendorOption[]> => {
    const res = await apiClient.get<{ data: VendorOption[] }>('/vendors', { params: { limit: 100 } });
    return res.data.data ?? [];
  },
};
