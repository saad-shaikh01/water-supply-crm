import { apiClient } from '@water-supply-crm/data-access';

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
  van?: { plateNumber: string };
}

export interface PaginatedTransactions {
  data: Transaction[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface TransactionQuery {
  page?: number;
  limit?: number;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const transactionsApi = {
  // Uses portal-scoped endpoint — no customerId needed, auth via JWT
  getAll: (_customerId: string, params: TransactionQuery) =>
    apiClient.get<PaginatedTransactions>('/portal/transactions', { params }),
};
