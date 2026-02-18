import { apiClient } from '@water-supply-crm/data-access';

export interface DeliveryQuery {
  page?: number;
  limit?: number;
}

export const deliveriesApi = {
  getAll: (params: DeliveryQuery) =>
    apiClient.get('/portal/deliveries', { params }),
  getSchedule: (params?: { from?: string; to?: string }) =>
    apiClient.get('/portal/schedule', { params }),
  getStatement: (params?: { month?: string }) =>
    apiClient.get('/portal/statement', { params, responseType: 'blob' }),
};
