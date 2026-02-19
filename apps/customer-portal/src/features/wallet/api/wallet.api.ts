import { apiClient } from '@water-supply-crm/data-access';

export interface PortalProfile {
  id: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  financialBalance: number;
  paymentType: 'MONTHLY' | 'CASH';
  route?: { id: string; name: string } | null;
  bottleWallets?: Array<{ product: { name: string }; quantity: number; price: number }>;
  createdAt: string;
}

export interface PortalBalance {
  financialBalance: number;
  bottleWallets: Array<{
    productId: string;
    product: { name: string };
    quantity: number;
    effectivePrice: number;
  }>;
}

export const walletApi = {
  getProfile: () =>
    apiClient.get<PortalProfile>('/portal/me'),

  getBalance: () =>
    apiClient.get<PortalBalance>('/portal/balance'),

  // Legacy summary — uses portal transactions
  getSummary: () =>
    apiClient.get('/portal/transactions/summary'),
};
