import { apiClient } from '@water-supply-crm/data-access';

export interface CustomerQuery {
  search?: string;
  page?: number;
  limit?: number;
  routeId?: string;
}

export const customersApi = {
  getAll: (params: CustomerQuery) => apiClient.get('/customers', { params }),
  getOne: (id: string) => apiClient.get(`/customers/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/customers', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/customers/${id}`, data),
  remove: (id: string) => apiClient.delete(`/customers/${id}`),
  setCustomPrice: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/custom-prices`, data),
  createPortalAccount: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/portal-account`, data),
  removePortalAccount: (customerId: string) =>
    apiClient.delete(`/customers/${customerId}/portal-account`),
  getWalletBalance: (customerId: string) =>
    apiClient.get(`/customers/${customerId}/wallet`),
};
