import { apiClient } from '@water-supply-crm/data-access';

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  entity?: string;
  action?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const auditLogsApi = {
  getAll: (params: AuditLogQuery) => apiClient.get('/audit-logs', { params }),
  getOne: (id: string) => apiClient.get(`/audit-logs/${id}`),
};
