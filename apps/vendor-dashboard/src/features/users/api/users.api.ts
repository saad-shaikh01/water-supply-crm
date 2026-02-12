import { apiClient } from '@water-supply-crm/data-access';

export const usersApi = {
  getAll: () => apiClient.get('/users'),
  getOne: (id: string) => apiClient.get(`/users/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/users', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/users/${id}`, data),
  remove: (id: string) => apiClient.delete(`/users/${id}`),
};
