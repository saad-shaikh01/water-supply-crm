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

  /**
   * Upload a single file to Wasabi via the backend.
   * Returns { key, url, name } for use in ticket message attachments.
   */
  uploadAttachment: (formData: FormData) =>
    apiClient.post<{ key: string; url: string; name: string }>(
      '/portal/tickets/upload-attachment',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ),
};
