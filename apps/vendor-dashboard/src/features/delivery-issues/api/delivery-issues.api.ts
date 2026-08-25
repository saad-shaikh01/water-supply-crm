import { apiClient } from '@water-supply-crm/data-access';

export const deliveryIssuesApi = {
  getAll: (params: {
    page?: number;
    limit?: number;
    status?: string;
    sheetId?: string;
    assignedToUserId?: string;
    vanId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => apiClient.get('/delivery-issues', { params }),

  getOne: (id: string) => apiClient.get(`/delivery-issues/${id}`),

  plan: (
    id: string,
    data: {
      nextAction: string;
      retryAt?: string;
      assignedToUserId?: string;
      assignedVanId?: string;
      assignedDriverId?: string;
      notes?: string;
    },
  ) => apiClient.patch(`/delivery-issues/${id}/plan`, data),

  resolve: (
    id: string,
    data: { resolution: string; notes?: string },
  ) => apiClient.patch(`/delivery-issues/${id}/resolve`, data),

  // Phase 3 — reuses moveDeliveryItems() under the hood (see backend service);
  // this is not a second scheduling system, just a bulk entry point into the
  // existing plan() + move flow.
  bulkSchedule: (data: {
    issueIds: string[];
    destinationVanId: string;
    destinationDate: string;
    notes?: string;
  }) => apiClient.patch(`/delivery-issues/bulk-schedule`, data),

  // Phase 4 — loops the existing single resolve() per id; returns a per-id summary.
  bulkResolve: (data: {
    ids: string[];
    resolution: string;
    notes?: string;
  }) => apiClient.patch(`/delivery-issues/bulk-resolve`, data),
};
