import { apiClient } from '@water-supply-crm/data-access';

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  entity?: string;
  /** Filter to a single entity row — supported by the backend `AuditLogQueryDto`. */
  entityId?: string;
  action?: string;
  userId?: string;
  /** Every row touching this customer (the Customer itself + related records). */
  customerId?: string;
  /** Free text across user name, action, entity and entity id. */
  search?: string;
  /** ISO timestamps (inclusive). */
  from?: string;
  to?: string;
}

export interface AuditFilterOptions {
  entities: string[];
  actions: string[];
  users: { id: string; name: string }[];
}

export const auditLogsApi = {
  getAll: (params: AuditLogQuery) => apiClient.get('/audit-logs', { params }),
  getOne: (id: string) => apiClient.get(`/audit-logs/${id}`),
  getFilterOptions: () => apiClient.get<AuditFilterOptions>('/audit-logs/filter-options'),
};
