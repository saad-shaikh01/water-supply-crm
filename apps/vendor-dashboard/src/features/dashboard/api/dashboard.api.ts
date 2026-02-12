import { apiClient } from '@water-supply-crm/data-access';

export const dashboardApi = {
  getOverview: () => apiClient.get('/dashboard/overview'),
  getDaily: (date: string) => apiClient.get('/dashboard/daily', { params: { date } }),
};
