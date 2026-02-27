import { apiClient } from '@water-supply-crm/data-access';

export const deliveryIssuesApi = {
  getAll: (params: {
    page?: number;
    limit?: number;
    status?: string;
    sheetId?: string;
    assignedToUserId?: string;
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
};
