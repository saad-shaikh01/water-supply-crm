import { apiClient } from '@water-supply-crm/data-access';

export type ExpenseCategory = 'FUEL' | 'MAINTENANCE' | 'SALARY' | 'REPAIR' | 'OTHER';

export interface ExpenseQuery {
  page?: number;
  limit?: number;
  category?: ExpenseCategory;
  dateFrom?: string;
  dateTo?: string;
  vanId?: string;
}

export const expensesApi = {
  getAll: (params: ExpenseQuery) => apiClient.get('/expenses', { params }),
  getSummary: () => apiClient.get('/expenses/summary'),
  getOne: (id: string) => apiClient.get(`/expenses/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/expenses', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/expenses/${id}`, data),
  remove: (id: string) => apiClient.delete(`/expenses/${id}`),
};
