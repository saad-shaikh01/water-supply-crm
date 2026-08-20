import { apiClient } from '@water-supply-crm/data-access';

export type ExpenseCategory =
  | 'LUNCH_EXPENSE_EMPLOYEE' | 'ADVANCE_SALARY_EMPLOYEE' | 'VEHICLE_MAINTENANCE' | 'FUEL_EXPENSE' | 'OTHER'
  // Added 2026-08-21 — new selectable categories (see expense-form.tsx CATEGORIES).
  | 'ICE_PURCHASED' | 'EXTRA_LOADER';

export interface ExpenseQuery {
  page?: number;
  limit?: number;
  category?: ExpenseCategory;
  from?: string;
  to?: string;
  vanId?: string;
  dailySheetId?: string;
}

export interface ExpenseSummaryItem {
  category: ExpenseCategory;
  totalAmount: number;
  count: number;
}

export interface ExpenseSummary {
  breakdown: ExpenseSummaryItem[];
  grandTotal: number;
  totalRevenue: number;
  grossProfit: number;
}

export const expensesApi = {
  getAll: (params: ExpenseQuery) => apiClient.get('/expenses', { params }),
  getSummary: (params?: Pick<ExpenseQuery, 'from' | 'to'>) => apiClient.get<ExpenseSummary>('/expenses/summary', { params }),
  getOne: (id: string) => apiClient.get(`/expenses/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('/expenses', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/expenses/${id}`, data),
  remove: (id: string) => apiClient.delete(`/expenses/${id}`),
};
