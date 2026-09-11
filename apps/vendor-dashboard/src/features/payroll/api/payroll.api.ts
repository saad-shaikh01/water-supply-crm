import { apiClient } from '@water-supply-crm/data-access';
import type {
  AttendanceStatus,
  CreatableStaffLedgerCategory,
  PayFrequency,
  SettlementMethod,
  StaffAttendance,
} from '@water-supply-crm/types';

export interface CreateSalaryStructureData {
  userId: string;
  /** Whole positive rupees only — mirrors `CreateSalaryStructureDto.baseAmount` (no fractional currency).
   * Meaning depends on `payFrequency`: MONTHLY = monthly salary, DAILY = daily rate,
   * WEEKLY = rate per 7-calendar-day week (Staff Attendance & Wage Types Phase 3). */
  baseAmount: number;
  /** Defaults to MONTHLY server-side when omitted. */
  payFrequency?: PayFrequency;
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

/** Body for `POST /payroll/attendance/mark`. `amount` is required only for ABSENT / HALF_DAY. */
export interface MarkAttendanceData {
  userId: string;
  /** YYYY-MM-DD — becomes the ledger entry's effectiveDate verbatim for ABSENT/HALF_DAY. */
  date: string;
  status: AttendanceStatus;
  note?: string;
  /** Whole positive rupees; the server applies the debit sign. */
  amount?: number;
}

/** A `StaffAttendance` row as returned by the attendance list endpoints (employee relation included). */
export interface AttendanceRecord extends StaffAttendance {
  user: { id: string; name: string; role: string };
  leaveLedgerEntry: { id: string; category: string; amount: number; status: string } | null;
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

  // Attendance (Staff Attendance & Wage Types — Phase 2)
  getAttendanceForPeriod: (periodId: string) => apiClient.get(`/payroll/attendance/period/${periodId}`),
  getAttendanceForEmployee: (userId: string) => apiClient.get(`/payroll/attendance/employee/${userId}`),
  markAttendance: (data: MarkAttendanceData) => apiClient.post('/payroll/attendance/mark', data),
};
