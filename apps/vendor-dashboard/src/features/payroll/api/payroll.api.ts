import { apiClient } from '@water-supply-crm/data-access';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';

export interface CreateLedgerEntryData {
  userId: string;
  category: CreatableStaffLedgerCategory;
  /** Already signed per category — see `constants.ts`'s `LEDGER_CATEGORY_CONFIG`. */
  amount: number;
  effectiveDate: string;
  description?: string;
}

export interface LedgerEntryQuery {
  page?: number;
  limit?: number;
  category?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const payrollApi = {
  // Salary structures
  getSalaryHistory: (userId: string) => apiClient.get(`/payroll/salary-structures/employee/${userId}`),
  getEffectiveSalary: (userId: string, date?: string) =>
    apiClient.get(`/payroll/salary-structures/employee/${userId}/effective`, { params: date ? { date } : undefined }),

  // Ledger entries
  getLedgerForEmployee: (userId: string, params?: LedgerEntryQuery) =>
    apiClient.get(`/payroll/ledger-entries/employee/${userId}`, { params }),
  createLedgerEntry: (data: CreateLedgerEntryData) => apiClient.post('/payroll/ledger-entries', data),

  // Periods / entries
  getOrCreateOpenPeriod: () => apiClient.post('/payroll/periods/open'),
  getEntriesForPeriod: (periodId: string) => apiClient.get(`/payroll/periods/${periodId}/entries`),
};
