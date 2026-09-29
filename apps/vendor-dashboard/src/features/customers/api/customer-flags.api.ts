import { apiClient } from '@water-supply-crm/data-access';

export const customerFlagCategoriesApi = {
  getAll: () => apiClient.get('/customer-flag-categories'),
  create: (data: { name: string; color: string; defaultMessage?: string }) =>
    apiClient.post('/customer-flag-categories', data),
  update: (id: string, data: { name?: string; color?: string; defaultMessage?: string; isActive?: boolean }) =>
    apiClient.patch(`/customer-flag-categories/${id}`, data),
  remove: (id: string) => apiClient.delete(`/customer-flag-categories/${id}`),
};

export const customerFlagsApi = {
  history: (customerId: string) => apiClient.get(`/customers/${customerId}/flags`),
  apply: (customerId: string, data: { categoryId: string; message?: string }) =>
    apiClient.post(`/customers/${customerId}/flags`, data),
  resolve: (customerId: string, flagId: string, data: { resolvedReason?: string }) =>
    apiClient.post(`/customers/${customerId}/flags/${flagId}/resolve`, data),
};
