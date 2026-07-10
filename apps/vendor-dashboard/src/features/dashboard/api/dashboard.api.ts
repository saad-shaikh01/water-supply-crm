import { apiClient } from '@water-supply-crm/data-access';

export const dashboardApi = {
  getOverview: () => apiClient.get('/dashboard/overview'),
  getDaily: (date: string) => apiClient.get('/dashboard/daily-stats', { params: { date } }),
  getRevenue: (dateFrom: string, dateTo: string) =>
    apiClient.get('/dashboard/revenue', { params: { dateFrom, dateTo } }),
  getTopCustomers: (limit = 5) =>
    apiClient.get('/dashboard/top-customers', { params: { limit } }),
  getMonthlySummary: (months = 6) =>
    apiClient.get('/dashboard/monthly-summary', { params: { months } }),
};
