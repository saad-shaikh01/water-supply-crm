import { apiClient } from '@water-supply-crm/data-access';

export const usersApi = {
  getAll: (params?: any) => apiClient.get('/users', { params }),
  getOne: (id: string) => apiClient.get(`/users/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/users', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/users/${id}`, data),
  remove: (id: string) => apiClient.delete(`/users/${id}`),
  deactivate: (id: string) => apiClient.patch(`/users/${id}/deactivate`),
  reactivate: (id: string) => apiClient.patch(`/users/${id}/reactivate`),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiClient.patch('/users/me/change-password', data),
};
