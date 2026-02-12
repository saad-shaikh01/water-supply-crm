import { apiClient } from '@water-supply-crm/data-access';

export interface TransactionQuery {
  page?: number;
  limit?: number;
  customerId?: string;
  type?: string;
}

export const transactionsApi = {
  getAll: (params: TransactionQuery) => apiClient.get('/transactions', { params }),
  getOne: (id: string) => apiClient.get(`/transactions/${id}`),
  addPayment: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/payments`, data),
  addAdjustment: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post(`/customers/${customerId}/adjustments`, data),
};
