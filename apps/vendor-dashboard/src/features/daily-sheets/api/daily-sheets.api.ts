import { apiClient } from '@water-supply-crm/data-access';

export interface SheetQuery {
  page?: number;
  limit?: number;
  date?: string;
  routeId?: string;
  status?: string;
  driverId?: string;
}

export const dailySheetsApi = {
  getAll: (params: SheetQuery) => apiClient.get('/daily-sheets', { params }),
  getOne: (id: string) => apiClient.get(`/daily-sheets/${id}`),
  generate: (data: Record<string, unknown>) => apiClient.post('/daily-sheets/generate', data),
  startLoadOut: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/load-out`, data),
  startDeliveries: (id: string) =>
    apiClient.patch(`/daily-sheets/${id}/start-deliveries`),
  checkIn: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/check-in`, data),
  close: (id: string) => apiClient.patch(`/daily-sheets/${id}/close`),
  updateDeliveryItem: (sheetId: string, itemId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${sheetId}/items/${itemId}`, data),
};
