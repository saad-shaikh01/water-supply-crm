import { apiClient } from '@water-supply-crm/data-access';

export interface TransactionQuery {
  page?: number;
  limit?: number;
  customerId?: string;
  type?: string;
}

export interface PaymentRequestQuery {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
}

export const transactionsApi = {
  // Ledger Transactions
  getAll: (params: TransactionQuery) => apiClient.get('/transactions', { params }),
  getOne: (id: string) => apiClient.get(`/transactions/${id}`),
  addPayment: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post('/transactions/payments', { ...data, customerId }),
  addAdjustment: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post('/transactions/adjustments', { ...data, customerId }),

  // Payment Requests (Admin Review)
  getRequests: (params: PaymentRequestQuery) => apiClient.get('/payment-requests', { params }),
  getRequest: (id: string) => apiClient.get(`/payment-requests/${id}`),
  approveRequest: (id: string) => apiClient.patch(`/payment-requests/${id}/approve`),
  rejectRequest: (id: string, reason: string) => apiClient.patch(`/payment-requests/${id}/reject`, { reason }),
};
