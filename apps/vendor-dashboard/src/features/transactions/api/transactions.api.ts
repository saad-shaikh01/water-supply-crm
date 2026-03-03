import { apiClient } from '@water-supply-crm/data-access';

export interface TransactionQuery {
  page?: number;
  limit?: number;
  customerId?: string;
  vanId?: string;
  type?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaymentRequestQuery {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  method?: string;
  dateFrom?: string;
  dateTo?: string;
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

  /** Fetch a short-lived signed URL for the payment screenshot (private bucket). */
  getScreenshotUrl: (id: string) =>
    apiClient.get<{ signedUrl: string }>(`/payment-requests/${id}/screenshot`),
};
