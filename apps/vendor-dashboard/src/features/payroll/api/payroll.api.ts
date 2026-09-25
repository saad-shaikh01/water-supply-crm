import { apiClient } from '@water-supply-crm/data-access';
import type {
  AttendanceCategory,
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

/**
 * Linked Penalty (owner-approved 2026-09-25) — `POST /payroll/ledger-entries/linked-penalty`.
 * Atomically debits `userId` AND credits `customerId` the same amount (e.g. a driver
 * never recorded a customer's cash payment). `amount` is negative, mirroring the plain
 * PENALTY/DEDUCTION sign convention.
 */
export interface CreateLinkedPenaltyData {
  userId: string;
  category: 'PENALTY' | 'DEDUCTION';
  amount: number;
  effectiveDate: string;
  description?: string;
  customerId: string;
  customerCreditTitle: string;
}

export interface LinkedPenaltyResult {
  penaltyEntry: { id: string };
  customerAdjustment: { id: string };
  customerBalance: number;
}

export interface VoidLinkedPenaltyData {
  version: number;
  reason: string;
}

export interface LedgerEntryQuery {
  page?: number;
  limit?: number;
  category?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface VoidSalaryStructureData {
  voidReason: string;
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
  /** Required when `status` is PRESENT; rejected for every other status. */
  categoryId?: string;
}

export interface CreateAttendanceCategoryData {
  name: string;
}

// Advance Installments (owner-requested 2026-09-24)

export interface CreateAdvancePlanData {
  userId: string;
  principalAmount: number;
  defaultInstallmentAmount: number;
  disbursedAt: string;
  note?: string;
}

export interface UpdateAdvancePlanData {
  defaultInstallmentAmount?: number;
  note?: string;
}

export interface CollectAdvanceInstallmentData {
  /** Overrides the auto-generated scheduled amount, either direction, capped at the plan's remaining balance. */
  amount?: number;
}

export interface WriteOffAdvancePlanData {
  reason: string;
}

export interface AdvanceVendorSummary {
  activePlanCount: number;
  totalRemainingBalance: number;
}

/** A `StaffAttendance` row as returned by the attendance list endpoints (employee relation included). */
export interface AttendanceRecord extends StaffAttendance {
  user: { id: string; name: string; role: string };
  leaveLedgerEntry: { id: string; category: string; amount: number; status: string } | null;
  category: { id: string; name: string } | null;
}

/** Response of `POST /payroll/attendance/period/:periodId/backfill`. */
export interface AttendanceBackfillResult {
  sheetsScanned: number;
  sheetsTouched: number;
  created: number;
}

/** Query for `GET /payroll/attendance/search` — `dateFrom`/`dateTo` are required (a bounded report, not a full dump). */
export interface AttendanceSearchQuery {
  dateFrom: string;
  dateTo: string;
  categoryId?: string;
  userId?: string;
  status?: AttendanceStatus;
}

export interface AttendanceSearchRow {
  id: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  userId: string;
  userName: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface AttendanceSearchResult {
  rows: AttendanceSearchRow[];
  summary: {
    totalRows: number;
    distinctEmployees: number;
    byEmployee: Array<{ userId: string; userName: string; count: number }>;
  };
}

export const payrollApi = {
  // Salary structures
  getSalaryHistory: (userId: string) => apiClient.get(`/payroll/salary-structures/employee/${userId}`),
  getEffectiveSalary: (userId: string, date?: string) =>
    apiClient.get(`/payroll/salary-structures/employee/${userId}/effective`, { params: date ? { date } : undefined }),
  createSalaryStructure: (data: CreateSalaryStructureData) => apiClient.post('/payroll/salary-structures', data),
  voidSalaryStructure: (id: string, data: VoidSalaryStructureData) =>
    apiClient.post(`/payroll/salary-structures/${id}/void`, data),

  // Ledger entries
  getLedgerForEmployee: (userId: string, params?: LedgerEntryQuery) =>
    apiClient.get(`/payroll/ledger-entries/employee/${userId}`, { params }),
  createLedgerEntry: (data: CreateLedgerEntryData) => apiClient.post('/payroll/ledger-entries', data),

  // Linked Penalty (owner-approved 2026-09-25)
  createLinkedPenalty: (data: CreateLinkedPenaltyData) =>
    apiClient.post<LinkedPenaltyResult>('/payroll/ledger-entries/linked-penalty', data),
  voidLinkedPenalty: (id: string, data: VoidLinkedPenaltyData) =>
    apiClient.patch<LinkedPenaltyResult>(`/payroll/ledger-entries/${id}/void-linked`, data),

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
  backfillAttendance: (periodId: string) =>
    apiClient.post<AttendanceBackfillResult>(`/payroll/attendance/period/${periodId}/backfill`, {}),
  searchAttendance: (params: AttendanceSearchQuery) =>
    apiClient.get<AttendanceSearchResult>('/payroll/attendance/search', { params }),

  // Attendance categories — the required reason field on a manual PRESENT
  // marking (e.g. "office — other business"). Vendor-managed, no built-ins.
  getAttendanceCategories: () => apiClient.get<AttendanceCategory[]>('/payroll/attendance-categories'),
  createAttendanceCategory: (data: CreateAttendanceCategoryData) =>
    apiClient.post<AttendanceCategory>('/payroll/attendance-categories', data),
  deleteAttendanceCategory: (id: string) => apiClient.delete(`/payroll/attendance-categories/${id}`),

  // Advance Installments (owner-requested 2026-09-24)
  createAdvancePlan: (data: CreateAdvancePlanData) => apiClient.post('/payroll/advance-plans', data),
  updateAdvancePlan: (id: string, data: UpdateAdvancePlanData) => apiClient.patch(`/payroll/advance-plans/${id}`, data),
  getAdvancePlansForEmployee: (userId: string) => apiClient.get(`/payroll/advance-plans/employee/${userId}`),
  collectAdvanceInstallment: (id: string, data: CollectAdvanceInstallmentData) =>
    apiClient.post(`/payroll/advance-installments/${id}/collect`, data),
  skipAdvanceInstallment: (id: string) => apiClient.post(`/payroll/advance-installments/${id}/skip`),
  writeOffAdvancePlan: (id: string, data: WriteOffAdvancePlanData) =>
    apiClient.post(`/payroll/advance-plans/${id}/write-off`, data),
  getAdvanceVendorSummary: () => apiClient.get<AdvanceVendorSummary>('/payroll/advance-plans/vendor-summary'),
  getPendingInstallmentCount: (periodId: string) =>
    apiClient.get<number>(`/payroll/advance-installments/period/${periodId}/pending-count`),
};
