import { apiClient } from '@water-supply-crm/data-access';

export const ticketsApi = {
  getAll: (params: { page?: number; limit?: number; status?: string; type?: string }) =>
    apiClient.get('/portal/tickets', { params }),

  getById: (id: string) =>
    apiClient.get(`/portal/tickets/${id}`),

  getMessages: (id: string) =>
    apiClient.get(`/portal/tickets/${id}/messages`),

  create: (data: {
    type: string;
    subject: string;
    description: string;
    priority?: string;
  }) => apiClient.post('/portal/tickets', data),

  createMessage: (
    id: string,
    data: {
      message: string;
      attachments?: Array<Record<string, unknown>>;
    }
  ) => apiClient.post(`/portal/tickets/${id}/messages`, data),
};
