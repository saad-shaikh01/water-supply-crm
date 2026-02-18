import { apiClient } from '@water-supply-crm/data-access';

export const routesApi = {
  getAll: (params?: any) => apiClient.get('/routes', { params }),
  getOne: (id: string) => apiClient.get(`/routes/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/routes', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/routes/${id}`, data),
  remove: (id: string) => apiClient.delete(`/routes/${id}`),
};
