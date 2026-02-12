import { apiClient } from '@water-supply-crm/data-access';

export const productsApi = {
  getAll: () => apiClient.get('/products'),
  getOne: (id: string) => apiClient.get(`/products/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/products', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/products/${id}`, data),
  remove: (id: string) => apiClient.delete(`/products/${id}`),
  toggle: (id: string) => apiClient.patch(`/products/${id}/toggle`),
};
