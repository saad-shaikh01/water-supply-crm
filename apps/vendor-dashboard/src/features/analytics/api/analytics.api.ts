import { apiClient } from '@water-supply-crm/data-access';

export const analyticsApi = {
  getFinancial: (from: string, to: string) =>
    apiClient.get('/analytics/financial', { params: { from: from || undefined, to: to || undefined } }),
  getDeliveries: (from: string, to: string) =>
    apiClient.get('/analytics/deliveries', { params: { from: from || undefined, to: to || undefined } }),
  getCustomers: (from: string, to: string) =>
    apiClient.get('/analytics/customers', { params: { from: from || undefined, to: to || undefined } }),
  getStaff: (from: string, to: string) =>
    apiClient.get('/analytics/staff', { params: { from: from || undefined, to: to || undefined } }),
};
