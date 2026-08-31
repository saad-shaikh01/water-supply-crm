import { apiClient } from '@water-supply-crm/data-access';

export interface TransactionQuery {
  page?: number;
  limit?: number;
  customerId?: string;
  vanId?: string;
  type?: string;
  /** PaymentMode filter — 'CASH' | 'CHEQUE' | 'BANK_TRANSFER'. */
  paymentMode?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CustomerPrevMonthOutstanding {
  paymentType: 'MONTHLY' | 'CASH';
  currentMonthPaid: number;
  prevMonthOutstanding: number;
  currentOutstanding: number;
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

  /** Monthly snapshot for the Record Payment dialog (prev-month outstanding vs. this month's payments). */
  getPrevMonthOutstanding: (customerId: string) =>
    apiClient.get<CustomerPrevMonthOutstanding>(
      `/transactions/customers/${customerId}/prev-month-outstanding`,
    ),
  addAdjustment: (customerId: string, data: Record<string, unknown>) =>
    apiClient.post('/transactions/adjustments', { ...data, customerId }),

  // Manual payment edit / delete (docs — payment edit/delete feature).
  // `data` is passed through verbatim: the backend expects `expectedUpdatedAt`
  // to be the exact `updatedAt` ISO string the row was loaded with.
  editPayment: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/transactions/payments/${id}`, data),
  deletePayment: (id: string, data: Record<string, unknown>) =>
    apiClient.delete(`/transactions/payments/${id}`, { data }),

  // Payment Requests (Admin Review)
  getRequests: (params: PaymentRequestQuery) => apiClient.get('/payment-requests', { params }),
  getRequest: (id: string) => apiClient.get(`/payment-requests/${id}`),
  approveRequest: (id: string) => apiClient.patch(`/payment-requests/${id}/approve`),
  rejectRequest: (id: string, reason: string) => apiClient.patch(`/payment-requests/${id}/reject`, { reason }),

  /** Fetch a short-lived signed URL for the payment screenshot (private bucket). */
  getScreenshotUrl: (id: string) =>
    apiClient.get<{ signedUrl: string }>(`/payment-requests/${id}/screenshot`),
};
