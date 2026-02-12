import { apiClient } from '@water-supply-crm/data-access';

export const vansApi = {
  getAll: () => apiClient.get('/vans'),
  getOne: (id: string) => apiClient.get(`/vans/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/vans', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vans/${id}`, data),
  remove: (id: string) => apiClient.delete(`/vans/${id}`),
};
