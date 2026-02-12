import { apiClient } from '@water-supply-crm/data-access';

export interface VendorQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export const vendorsApi = {
  getAll: (params: VendorQuery) => apiClient.get('/vendors', { params }),
  getOne: (id: string) => apiClient.get(`/vendors/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/vendors', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vendors/${id}`, data),
  remove: (id: string) => apiClient.delete(`/vendors/${id}`),
};
