import { apiClient } from '@water-supply-crm/data-access';

export interface CustomerQuery {
  search?: string;
  page?: number;
  limit?: number;
  routeId?: string;
  paymentType?: 'MONTHLY' | 'CASH';
  isActive?: boolean;
  balanceMin?: number;
  balanceMax?: number;
}

export const customersApi = {
  getAll: (params: CustomerQuery) => apiClient.get('/customers', { params }),
  getOne: (id: string) => apiClient.get(`/customers/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/customers', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/customers/${id}`, data),
  remove: (id: string) => apiClient.delete(`/customers/${id}`),
  deactivate: (id: string) => apiClient.patch(`/customers/${id}/deactivate`),
  reactivate: (id: string) => apiClient.patch(`/customers/${id}/reactivate`),
  setCustomPrice: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/custom-prices`, data),
  removeCustomPrice: (customerId: string, productId: string) =>
    apiClient.delete(`/customers/${customerId}/custom-prices/${productId}`),
  createPortalAccount: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/portal-account`, data),
  removePortalAccount: (customerId: string) =>
    apiClient.delete(`/customers/${customerId}/portal-account`),
  getConsumption: (id: string, params?: Record<string, unknown>) =>
    apiClient.get(`/customers/${id}/consumption`, { params }),
  getStatement: (id: string, params?: Record<string, unknown>) =>
    apiClient.get(`/customers/${id}/statement`, { params, responseType: 'blob' }),
  getSchedule: (id: string, params?: Record<string, unknown>) =>
    apiClient.get(`/customers/${id}/schedule`, { params }),
};
