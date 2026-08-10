import { apiClient } from '@water-supply-crm/data-access';
import type { CreatableStaffLedgerCategory, SettlementMethod } from '@water-supply-crm/types';

export interface CreateSalaryStructureData {
  userId: string;
  /** Whole positive rupees only — mirrors `CreateSalaryStructureDto.baseAmount` (no fractional currency). */
  baseAmount: number;
  effectiveFrom: string;
}

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

export interface RecordSettlementData {
  amount: number;
  method: SettlementMethod;
  referenceNote?: string;
}

export const payrollApi = {
  // Salary structures
  getSalaryHistory: (userId: string) => apiClient.get(`/payroll/salary-structures/employee/${userId}`),
  getEffectiveSalary: (userId: string, date?: string) =>
    apiClient.get(`/payroll/salary-structures/employee/${userId}/effective`, { params: date ? { date } : undefined }),
  createSalaryStructure: (data: CreateSalaryStructureData) => apiClient.post('/payroll/salary-structures', data),

  // Ledger entries
  getLedgerForEmployee: (userId: string, params?: LedgerEntryQuery) =>
    apiClient.get(`/payroll/ledger-entries/employee/${userId}`, { params }),
  createLedgerEntry: (data: CreateLedgerEntryData) => apiClient.post('/payroll/ledger-entries', data),

  // Periods / entries
  listPeriods: () => apiClient.get('/payroll/periods'),
  getOrCreateOpenPeriod: () => apiClient.post('/payroll/periods/open'),
  getEntriesForPeriod: (periodId: string) => apiClient.get(`/payroll/periods/${periodId}/entries`),
  generateDraft: (periodId: string) => apiClient.post(`/payroll/periods/${periodId}/entries/generate`),
  getEntryBreakdown: (entryId: string) => apiClient.get(`/payroll/entries/${entryId}/breakdown`),
  approveEntry: (entryId: string, version: number) =>
    apiClient.patch(`/payroll/entries/${entryId}/approve`, { version }),
  lockPeriod: (periodId: string) => apiClient.patch(`/payroll/periods/${periodId}/lock`),
  unlockPeriod: (periodId: string, reason: string) =>
    apiClient.patch(`/payroll/periods/${periodId}/unlock`, { reason }),

  // Settlements
  recordSettlement: (entryId: string, data: RecordSettlementData) =>
    apiClient.post(`/payroll/entries/${entryId}/settlements`, data),
  markSettled: (entryId: string, version: number) =>
    apiClient.patch(`/payroll/entries/${entryId}/mark-settled`, { version }),
  getSettlementsForEntry: (entryId: string) => apiClient.get(`/payroll/entries/${entryId}/settlements`),
};
