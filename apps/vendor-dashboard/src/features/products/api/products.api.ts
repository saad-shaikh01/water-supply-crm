import { apiClient } from '@water-supply-crm/data-access';

export interface ProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  sortDir?: 'asc' | 'desc';
}

export const productsApi = {
  getAll: (params?: ProductQuery) => apiClient.get('/products', { params }),
  getOne: (id: string) => apiClient.get(`/products/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/products', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/products/${id}`, data),
  remove: (id: string) => apiClient.delete(`/products/${id}`),
  toggle: (id: string) => apiClient.patch(`/products/${id}/toggle-active`),
};
