import { apiClient } from '@water-supply-crm/data-access';

export const ticketsApi = {
  getAll: (params: { page?: number; limit?: number; type?: string; status?: string }) =>
    apiClient.get('/tickets', { params }),

  reply: (id: string, data: { vendorReply: string; status?: string }) =>
    apiClient.patch(`/tickets/${id}/reply`, data),
};
