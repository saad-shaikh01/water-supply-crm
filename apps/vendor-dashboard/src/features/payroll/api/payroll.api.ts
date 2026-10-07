import { apiClient } from '@water-supply-crm/data-access';
import { filenameFromContentDisposition } from '../../van-cash-ledger/lib/download-file';
import type {
  AttendanceCategory,
  AttendanceStatus,
  CreatableStaffLedgerCategory,
  PayFrequency,
  SettlementMethod,
  StaffAttendance,
  StaffLedgerCategory,
} from '@water-supply-crm/types';

/**
 * Dual-Cutoff Payroll Flexibility (owner-requested 2026-09-25) —
 * `PayrollVendorConfig`'s attendance cutoff + the optional, separately-
 * anchored cash-deduction window (see the schema comment on
 * `PayrollVendorConfig`). Every field is eligible for `cashWindowCategories`
 * except ADVANCE_DISBURSEMENT, which never enters a PayrollEntry bucket at
 * all (mirrors `CASH_WINDOW_ELIGIBLE_CATEGORIES` in the backend DTO).
 */
export interface PayrollVendorConfigData {
  cutoffDay: number;
  cashCutoffDay: number | null;
  cashWindowCategories: StaffLedgerCategory[];
  autoLockEnabled: boolean;
  /** Max share of base salary one period may deduct (1-100); null = no ceiling (the default). */
  maxDeductionPercent: number | null;
}

export type UpdatePayrollVendorConfigData = Omit<PayrollVendorConfigData, 'autoLockEnabled' | 'maxDeductionPercent'> & {
  autoLockEnabled?: boolean;
  /** Omit to leave the current setting alone; null turns the ceiling off. */
  maxDeductionPercent?: number | null;
};

/** A CSV ready to hand to `saveBlob`. */
export interface PayrollCsvDownload {
  blob: Blob;
  filename: string;
}

// ── Salary slips on WhatsApp ────────────────────────────────────────────────

export type SlipVerdict = 'ELIGIBLE' | 'NOT_FINAL' | 'NO_PHONE';
export type SlipDeliveryStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'SKIPPED_NO_PHONE' | 'SKIPPED_DISCONNECTED' | 'FAILED';
export type SlipDispatchStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'ABORTED' | 'FAILED';

export interface SlipPreviewItem {
  entryId: string;
  userId: string;
  name: string;
  role: string;
  status: string;
  finalPayable: number;
  verdict: SlipVerdict;
  reason: string | null;
  alreadySent: { sentAt: string | null; finalPayable: number; amountChanged: boolean } | null;
}

export interface SlipPreviewResponse {
  periodId: string;
  periodLabel: string;
  items: SlipPreviewItem[];
  counts: { total: number; eligible: number; notFinal: number; noPhone: number; alreadySent: number };
}

export interface SendSlipsData {
  /** Omit for every entry of the period. */
  entryIds?: string[];
  /** Send entries that were already sent again. */
  confirmResend?: boolean;
  /** Leave already-sent entries out instead. */
  skipAlreadySent?: boolean;
}

export interface SendSlipsResult {
  dispatchId: string;
  status: SlipDispatchStatus;
  queued: number;
  skippedNoPhone: Array<{ entryId: string; name: string }>;
  skippedNotFinal: Array<{ entryId: string; name: string; status: string }>;
  skippedAlreadySent: Array<{ entryId: string; name: string }>;
}

export interface SlipDispatchProgress {
  id: string;
  status: SlipDispatchStatus;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface SlipEntryStatus {
  last: { status: SlipDeliveryStatus; error: string | null; at: string } | null;
  lastSent: { at: string | null; finalPayable: number; amountChanged: boolean } | null;
}

export interface SlipStatusResponse {
  activeDispatch: SlipDispatchProgress | null;
  latestDispatch: SlipDispatchProgress | null;
  entries: Record<string, SlipEntryStatus>;
}

export interface SlipDispatchDetail extends SlipDispatchProgress {
  deliveries: Array<{
    id: string;
    entryId: string;
    userId: string;
    name: string;
    status: SlipDeliveryStatus;
    error: string | null;
    sentAt: string | null;
    finalPayable: number;
  }>;
}

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
  /** ADVANCE only — false = paid by bank/online (not an office cash-out). Omitted = cash. */
  paidFromCash?: boolean;
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

/** What to do with a set of Absent / Half-day days (`POST /payroll/attendance/resolve-absences`). */
export type AbsenceDecisionAction = 'UNPAID' | 'WAIVE' | 'RESET';

export interface ResolveAbsencesData {
  userId: string;
  /** YYYY-MM-DD days, all of which must be Absent / Half-day rows. */
  dates: string[];
  action: AbsenceDecisionAction;
  /** Whole rupees per full absent day - required for UNPAID (a half-day is charged half), rejected otherwise. */
  dailyRate?: number;
  note?: string;
}

export interface ResolveAbsencesResult {
  action: AbsenceDecisionAction;
  requested: number;
  affected: number;
  unchanged: number;
  totalDeducted: number;
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
  /** Sunday AUTO_WEEKLY_OFF rows filled in — see `backfillForPeriod`. */
  weeklyOffCreated: number;
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

  voidLedgerEntry: (id: string, data: VoidLinkedPenaltyData) =>
    apiClient.patch(`/payroll/ledger-entries/${id}/void`, data),

  // "Deduct next month" - moves only the payroll attribution date, never effectiveDate / the Cash Ledger.
  deferLedgerEntry: (id: string, data: { periodId: string; version: number; reason: string }) =>
    apiClient.post(`/payroll/ledger-entries/${id}/defer`, data),
  undoDeferLedgerEntry: (id: string, data: { version: number; reason: string }) =>
    apiClient.post(`/payroll/ledger-entries/${id}/undo-defer`, data),

  // Post-lock fixes — new opposite-sign entries in the open period; the locked row is never touched.
  reverseLedgerEntry: (id: string, data: VoidLinkedPenaltyData) =>
    apiClient.post(`/payroll/ledger-entries/${id}/reverse`, data),
  correctLedgerEntry: (id: string, data: VoidLinkedPenaltyData & { correctedAmount: number }) =>
    apiClient.post(`/payroll/ledger-entries/${id}/correct`, data),

  // Linked Penalty (owner-approved 2026-09-25)
  createLinkedPenalty: (data: CreateLinkedPenaltyData) =>
    apiClient.post<LinkedPenaltyResult>('/payroll/ledger-entries/linked-penalty', data),
  voidLinkedPenalty: (id: string, data: VoidLinkedPenaltyData) =>
    apiClient.patch<LinkedPenaltyResult>(`/payroll/ledger-entries/${id}/void-linked`, data),

  // Periods / entries
  listPeriods: () => apiClient.get('/payroll/periods'),
  getOrCreateOpenPeriod: () => apiClient.post('/payroll/periods/open'),
  /** Today's (Asia/Karachi) period for the Attendance grid — find-or-create, `payroll:attendance_view`. */
  getCurrentAttendancePeriod: () => apiClient.post('/payroll/periods/current-attendance'),
  getEntriesForPeriod: (periodId: string) => apiClient.get(`/payroll/periods/${periodId}/entries`),
  generateDraft: (periodId: string) => apiClient.post(`/payroll/periods/${periodId}/entries/generate`),
  getEntryBreakdown: (entryId: string) => apiClient.get(`/payroll/entries/${entryId}/breakdown`),
  approveEntry: (entryId: string, version: number, acknowledgePendingAbsences?: boolean) =>
    apiClient.patch(`/payroll/entries/${entryId}/approve`, {
      version,
      ...(acknowledgePendingAbsences ? { acknowledgePendingAbsences: true } : {}),
    }),
  recalculateEntry: (entryId: string, version: number) =>
    apiClient.patch(`/payroll/entries/${entryId}/recalculate`, { version }),
  /** Whole period (one row per employee) as a CSV — same download shape as the Cash Ledger exports. */
  exportPeriodCsv: async (periodId: string, fallbackLabel: string): Promise<PayrollCsvDownload> => {
    const res = await apiClient.get<Blob>(`/payroll/periods/${periodId}/export.csv`, { responseType: 'blob' });
    const headers = res.headers as Record<string, string | undefined>;
    return {
      blob: res.data,
      filename: filenameFromContentDisposition(headers['content-disposition'], `payroll-${fallbackLabel}.csv`),
    };
  },

  // Salary slips on WhatsApp (payroll:slip_send; status needs payroll:view_all)
  getSlipStatus: (periodId: string) => apiClient.get<SlipStatusResponse>(`/payroll/periods/${periodId}/slips/status`),
  previewSlips: (periodId: string, entryIds?: string[]) =>
    apiClient.post<SlipPreviewResponse>(`/payroll/periods/${periodId}/slips/preview`, entryIds ? { entryIds } : {}),
  sendSlips: (periodId: string, data: SendSlipsData) =>
    apiClient.post<SendSlipsResult>(`/payroll/periods/${periodId}/slips/send`, data),
  getSlipDispatch: (dispatchId: string) => apiClient.get<SlipDispatchDetail>(`/payroll/slips/dispatches/${dispatchId}`),

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
  resolveAbsences: (data: ResolveAbsencesData) =>
    apiClient.post<ResolveAbsencesResult>('/payroll/attendance/resolve-absences', data),
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

  // Vendor config (Dual-Cutoff Payroll Flexibility, owner-requested 2026-09-25)
  getVendorConfig: () => apiClient.get<PayrollVendorConfigData>('/payroll/config'),
  updateVendorConfig: (data: UpdatePayrollVendorConfigData) =>
    apiClient.put<PayrollVendorConfigData>('/payroll/config', data),
};
