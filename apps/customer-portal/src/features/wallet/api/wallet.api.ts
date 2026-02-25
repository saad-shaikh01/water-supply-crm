import { apiClient } from '@water-supply-crm/data-access';

export interface PortalProfile {
  id: string;
  name: string;
  email?: string | null;
  phoneNumber?: string;
  address?: string;
  financialBalance: number;
  paymentType: 'MONTHLY' | 'CASH';
  floor?: string | null;
  nearbyLandmark?: string | null;
  deliveryInstructions?: string | null;
  createdAt: string;
  route?: { id: string; name: string } | null;
  deliverySchedules?: Array<{
    id: string;
    dayOfWeek: number;
    van?: { id: string; plateNumber: string } | null;
  }>;
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

export interface PortalSummary {
  totalPaid: number;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
  nextDeliveryDate: string | null;
}

export interface PortalProduct {
  id: string;
  name: string;
  basePrice: number;
}

export const walletApi = {
  getProfile: () =>
    apiClient.get<PortalProfile>('/portal/me'),

  getBalance: () =>
    apiClient.get<PortalBalance>('/portal/balance'),

  getSummary: () =>
    apiClient.get<PortalSummary>('/portal/summary'),

  getProducts: () =>
    apiClient.get<PortalProduct[]>('/portal/products'),
};
