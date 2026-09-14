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
