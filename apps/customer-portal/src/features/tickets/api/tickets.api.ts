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
   * Returns { key, name } — the key is stored in the message's attachments JSON.
   * Access is via getAttachmentUrl(), not a raw public URL.
   */
  uploadAttachment: (formData: FormData) =>
    apiClient.post<{ key: string; name: string }>(
      '/portal/tickets/upload-attachment',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ),

  /**
   * Generate a short-lived signed URL (15 min) for a ticket attachment.
   * Call this when the user wants to view or download an attachment.
   */
  getAttachmentUrl: (key: string) =>
    apiClient.get<{ signedUrl: string }>('/portal/tickets/attachment-url', {
      params: { key },
    }),
};
