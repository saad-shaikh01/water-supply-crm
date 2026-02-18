import { apiClient } from '@water-supply-crm/data-access';

export interface SheetQuery {
  page?: number;
  limit?: number;
  date?: string;
  routeId?: string;
  vanId?: string;
  status?: string;
  driverId?: string;
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
  updateDeliveryItem: (itemId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/items/${itemId}`, data),
  swapAssignment: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/swap-assignment`, data),
  exportPdf: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/export`, { responseType: 'blob' }),
};
