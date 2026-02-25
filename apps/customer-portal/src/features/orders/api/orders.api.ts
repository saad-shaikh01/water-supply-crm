import { apiClient } from '@water-supply-crm/data-access';

export const ordersApi = {
  getAll: (params: { page?: number; limit?: number; status?: string }) =>
    apiClient.get('/portal/orders', { params }),

  create: (data: {
    productId: string;
    quantity: number;
    note?: string;
    preferredDate?: string;
  }) => apiClient.post('/portal/orders', data),

  cancel: (id: string) => apiClient.delete(`/portal/orders/${id}`),
};
