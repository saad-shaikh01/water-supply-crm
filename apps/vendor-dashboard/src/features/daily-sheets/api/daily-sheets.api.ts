import { apiClient } from '@water-supply-crm/data-access';
import type { DeliveryItemNote } from '@water-supply-crm/types';

export interface SheetQuery {
  page?: number;
  limit?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  routeId?: string;
  vanId?: string;
  driverId?: string;
  isClosed?: boolean;
}

export const dailySheetsApi = {
  getAll: (params: SheetQuery) => apiClient.get('/daily-sheets', { params }),
  getOne: (id: string) => apiClient.get(`/daily-sheets/${id}`),
  generate: (data: Record<string, unknown>) => apiClient.post('/daily-sheets/generate', data).then((r) => r.data),
  getGenerationStatus: (jobId: string) => apiClient.get(`/daily-sheets/generation-status/${jobId}`).then((r) => r.data),
  loadOut: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/load-out`, data),
  checkIn: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/check-in`, data),
  close: (id: string) => apiClient.post(`/daily-sheets/${id}/close`),
  getReconciliationPreview: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/reconciliation-preview`).then((r) => r.data),
  insertItemFromOrder: (
    id: string,
    data: { orderId: string; sequenceMode?: 'APPEND' | 'CUSTOM'; sequence?: number },
  ) => apiClient.post(`/daily-sheets/${id}/items/from-order`, data),
  updateDeliveryItem: (itemId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/items/${itemId}`, data),
  swapAssignment: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/swap-assignment`, data),
  exportPdf: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/export`, { responseType: 'blob' }),
  exportInvoice: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/invoice`, { responseType: 'blob' }),
  // Load trips
  createLoad: (id: string, data: Record<string, unknown>) =>
    apiClient.post(`/daily-sheets/${id}/loads`, data),
  checkinLoad: (id: string, loadId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/loads/${loadId}/checkin`, data),
  getLoads: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/loads`),
  getCustomerDeliveryHistory: (customerId: string, limit = 6) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/delivery-history`, { params: { limit } }),
  getCustomerFinancialSummary: (customerId: string, sheetId: string) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/financial-summary`, { params: { sheetId } }),
  unlockDeliveryEdit: (itemId: string, data?: { windowMinutes?: number }) =>
    apiClient.patch(`/daily-sheets/items/${itemId}/unlock-edit`, data ?? {}),
  // Notes
  getItemNotes: (itemId: string) =>
    apiClient.get<DeliveryItemNote[]>(`/daily-sheets/items/${itemId}/notes`),
  addTextNote: (itemId: string, data: { type: 'TEXT'; text: string }) =>
    apiClient.post<DeliveryItemNote>(`/daily-sheets/items/${itemId}/notes`, data),
  addVoiceNote: (itemId: string, formData: FormData, duration?: number) =>
    apiClient.post<DeliveryItemNote>(
      `/daily-sheets/items/${itemId}/notes/voice${duration != null ? `?duration=${duration}` : ''}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ),
  acknowledgeNote: (noteId: string) =>
    apiClient.patch<DeliveryItemNote>(`/daily-sheets/items/notes/${noteId}/acknowledge`, {}),
  getNoteAudioUrl: (noteId: string) =>
    apiClient.get<{ signedUrl: string }>(`/daily-sheets/items/notes/${noteId}/audio`),
};
