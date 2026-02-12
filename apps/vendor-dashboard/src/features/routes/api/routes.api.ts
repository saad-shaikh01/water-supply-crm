import { apiClient } from '@water-supply-crm/data-access';

export const routesApi = {
  getAll: () => apiClient.get('/routes'),
  getOne: (id: string) => apiClient.get(`/routes/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/routes', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/routes/${id}`, data),
  remove: (id: string) => apiClient.delete(`/routes/${id}`),
};
