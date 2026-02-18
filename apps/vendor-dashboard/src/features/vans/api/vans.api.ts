import { apiClient } from '@water-supply-crm/data-access';

export const vansApi = {
  getAll: (params?: any) => apiClient.get('/vans', { params }),
  getOne: (id: string) => apiClient.get(`/vans/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/vans', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vans/${id}`, data),
  remove: (id: string) => apiClient.delete(`/vans/${id}`),
  deactivate: (id: string) => apiClient.patch(`/vans/${id}/deactivate`),
  reactivate: (id: string) => apiClient.patch(`/vans/${id}/reactivate`),
};
