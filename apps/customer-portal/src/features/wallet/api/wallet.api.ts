import { apiClient } from '@water-supply-crm/data-access';

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  walletBalance: number;
  bottleCount: number;
  route: { id: string; name: string } | null;
  createdAt: string;
}

export interface TransactionSummary {
  totalCredits: number;
  totalDebits: number;
  currentBalance: number;
  transactionCount: number;
}

export const walletApi = {
  getProfile: (customerId: string) =>
    apiClient.get<CustomerProfile>(`/customers/${customerId}`),

  getSummary: (customerId: string) =>
    apiClient.get<TransactionSummary>(`/transactions/customers/${customerId}/summary`),
};
