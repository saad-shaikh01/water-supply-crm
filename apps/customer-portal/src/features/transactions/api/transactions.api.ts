import { apiClient } from '@water-supply-crm/data-access';

export interface Transaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string | null;
  createdAt: string;
}

export interface PaginatedTransactions {
  data: Transaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TransactionQuery {
  page?: number;
  limit?: number;
}

export const transactionsApi = {
  getAll: (customerId: string, params: TransactionQuery) =>
    apiClient.get<PaginatedTransactions>(`/transactions/customers/${customerId}`, { params }),
};
