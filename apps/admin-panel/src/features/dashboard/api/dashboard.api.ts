import { apiClient } from '@water-supply-crm/data-access';

export const dashboardApi = {
  getOverview: () => apiClient.get('/dashboard/overview'),
};
