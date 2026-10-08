import { apiClient } from '@water-supply-crm/data-access';

export const analyticsApi = {
  getFinancial: (from: string, to: string, vanId?: string) =>
    apiClient.get('/analytics/financial', { params: { from: from || undefined, to: to || undefined, vanId: vanId || undefined } }),
  getDeliveries: (from: string, to: string, vanId?: string) =>
    apiClient.get('/analytics/deliveries', { params: { from: from || undefined, to: to || undefined, vanId: vanId || undefined } }),
  getCustomers: (from: string, to: string, vanId?: string) =>
    apiClient.get('/analytics/customers', { params: { from: from || undefined, to: to || undefined, vanId: vanId || undefined } }),
  getStaff: (from: string, to: string, vanId?: string) =>
    apiClient.get('/analytics/staff', { params: { from: from || undefined, to: to || undefined, vanId: vanId || undefined } }),
  getOperations: (from: string, to: string, vanId?: string) =>
    apiClient.get('/analytics/operations', { params: { from: from || undefined, to: to || undefined, vanId: vanId || undefined } }),
};

export const profitLossApi = {
  get: (month: string, adjust?: string, basis?: string, whatIf?: { plantRate?: number; capsRate?: number; basis?: string }) =>
    apiClient.get('/analytics/profit-loss', {
      params: {
        month,
        adjust: adjust || undefined,
        basis: basis || undefined,
        plantRate: whatIf?.plantRate || undefined,
        capsRate: whatIf?.capsRate || undefined,
        whatIfBasis: whatIf?.basis || undefined,
      },
    }),
  getDetails: (month: string, category: string, page: number) =>
    apiClient.get('/analytics/profit-loss/details', { params: { month, category, page, limit: 20 } }),
  getPayments: (month: string, kind: string, page: number) =>
    apiClient.get('/analytics/profit-loss/payments', { params: { month, kind, page, limit: 20 } }),
};
