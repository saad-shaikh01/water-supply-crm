import { apiClient } from '@water-supply-crm/data-access';

export const ordersApi = {
  getAll: (params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    customerId?: string;
    productId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) =>
    apiClient.get('/orders', { params }),

  approve: (id: string) =>
    apiClient.patch(`/orders/${id}/approve`),

  reject: (id: string, data: { rejectionReason: string }) =>
    apiClient.patch(`/orders/${id}/reject`, data),
};
