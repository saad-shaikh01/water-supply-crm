import { apiClient } from '@water-supply-crm/data-access';

/**
 * Van Cash Ledger — a running cash balance per van, folding a driver's Daily
 * Sheet cash handover (once office staff approves it) into a chronological
 * feed alongside the Expense Center's existing cash-paid costs.
 *
 * The types below are local mirrors of the backend contract, deliberately NOT
 * imported from `@water-supply-crm/types` — mirrors the Expense Center's own
 * `api/expense-center.api.ts` convention for a read-projection with no single
 * owning Prisma model.
 */

export type CashLedgerRowType =
  | 'OPENING_BALANCE'
  | 'CASH_IN'
  | 'CASH_IN_CORRECTION'
  | 'CASH_OUT'
  | 'CASH_REMITTANCE_OUT';

export type CashLedgerRowStatus = 'PENDING' | 'APPROVED' | null;

export interface CashLedgerRow {
  id: string;
  date: string;
  type: CashLedgerRowType;
  vanId: string | null;
  vanPlateNumber: string | null;
  title: string;
  /** Signed — positive for IN/opening, negative for OUT. A voided remittance row is 0 here (see `displayAmount`). */
  amount: number;
  /** Always the positive magnitude of the underlying record — non-zero even when `amount` is 0 for a voided row. */
  displayAmount: number;
  /** Cumulative, server-computed. */
  runningBalance: number;
  /** Only meaningful for CASH_IN / CASH_IN_CORRECTION. */
  status: CashLedgerRowStatus;
  /** The VanCashHandover / OfficeCashRemittance id, for the row's own action. */
  sourceRecordId: string | null;
  dailySheetId: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
  sourceBadge: string;
  /** Optimistic-concurrency token for the approve action — null where not applicable (opening balance / cash-out rows). */
  version: number | null;
  /** CASH_REMITTANCE_OUT only — true when the office→owner handover has been voided (shown struck-through, folds in as 0). */
  isVoided?: boolean;
  /** CASH_REMITTANCE_OUT only — the reason captured when the row was voided. */
  voidReason?: string | null;
  /** CASH_REMITTANCE_OUT only — true when this row is a DELTA correction row, not the root of a logical remittance. */
  isCorrection?: boolean;
}

export interface CashLedgerTimelineQuery {
  vanId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface CashLedgerTimelineMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CashLedgerTimelineResponse {
  data: CashLedgerRow[];
  meta: CashLedgerTimelineMeta;
}

export interface CashLedgerStatsQuery {
  vanId?: string;
  from?: string;
  to?: string;
}

export interface CashLedgerStats {
  /** Date-range scoped. */
  totalExpense: number;
  /** Date-range scoped. */
  totalCashIn: number;
  /** NOT date-range scoped — the true current balance. */
  availableBalance: number;
  pendingHandoverCount: number;
  /** Date-range scoped — sum of APPROVED office→owner remittances in the window. */
  totalRemitted: number;
  /** NOT date-range scoped — count of PENDING office→owner remittances awaiting approval. */
  pendingRemittanceCount: number;
}

export interface PendingHandoverQuery {
  vanId?: string;
}

export interface PendingHandover {
  id: string;
  dailySheetId: string;
  vanPlateNumber: string;
  driverName: string;
  date: string;
  amount: number;
  /** Optimistic-concurrency token required by the approve action. */
  version: number;
}

// ── Office Cash Remittance (office → owner / CEO / bank) ─────────────────────

export type RemittanceDestination = 'OWNER' | 'CEO' | 'BANK' | 'OTHER';
export type RemittanceStatus = 'PENDING' | 'APPROVED' | 'VOIDED';

export interface PendingRemittance {
  id: string;
  amount: number;
  date: string;
  destination: RemittanceDestination;
  destinationName: string | null;
  reference: string | null;
  note: string | null;
  attachmentKey: string | null;
  submittedBy: { id: string; name: string } | null;
  correctsEntryId: string | null;
  /** Optimistic-concurrency token required by the approve action. */
  version: number;
}

export interface CreateRemittancePayload {
  amount: number;
  date: string;
  destination: RemittanceDestination;
  destinationName?: string;
  reference?: string;
  note?: string;
  attachmentKey?: string;
}

export interface CreateRemittanceResult extends PendingRemittance {
  status: RemittanceStatus;
  /** Server-computed — true when the recorded amount exceeds current office cash. */
  wouldGoNegative: boolean;
  availableBalance: number;
}

export interface ApproveRemittancePayload {
  version: number;
  approvedAmount?: number;
  adjustmentReason?: string;
  negativeOverrideReason?: string;
}

export interface VoidRemittancePayload {
  version: number;
  voidReason: string;
}

export interface CorrectRemittancePayload {
  version: number;
  newAmount: number;
  destinationName?: string;
  reference?: string;
  correctionReason: string;
}

export interface SetOpeningBalancePayload {
  vanId: string;
  openingBalance: number;
  openingDate: string;
}

export interface ApproveHandoverPayload {
  version: number;
  approvedAmount?: number;
  adjustmentReason?: string;
}

export const vanCashLedgerApi = {
  setOpeningBalance: (data: SetOpeningBalancePayload) =>
    apiClient.post('/van-cash-ledger/opening-balance', data),
  getTimeline: (params: CashLedgerTimelineQuery) =>
    apiClient.get<CashLedgerTimelineResponse>('/van-cash-ledger/timeline', { params }),
  getStats: (params?: CashLedgerStatsQuery) =>
    apiClient.get<CashLedgerStats>('/van-cash-ledger/stats', { params }),
  getPendingHandovers: (params?: PendingHandoverQuery) =>
    apiClient.get<PendingHandover[]>('/van-cash-ledger/pending-handovers', { params }),
  approveHandover: (id: string, data: ApproveHandoverPayload) =>
    apiClient.patch(`/van-cash-ledger/cash-in/${id}/approve`, data),

  // Office Cash Remittance
  getPendingRemittances: () =>
    apiClient.get<PendingRemittance[]>('/van-cash-ledger/pending-remittances'),
  createRemittance: (data: CreateRemittancePayload) =>
    apiClient.post<CreateRemittanceResult>('/van-cash-ledger/remittance', data),
  uploadRemittanceAttachment: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/van-cash-ledger/remittance/attachment', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  getRemittanceAttachment: (id: string) =>
    apiClient.get<{ signedUrl: string }>(`/van-cash-ledger/remittance/${id}/attachment`),
  approveRemittance: (id: string, data: ApproveRemittancePayload) =>
    apiClient.patch(`/van-cash-ledger/remittance/${id}/approve`, data),
  correctRemittance: (id: string, data: CorrectRemittancePayload) =>
    apiClient.patch(`/van-cash-ledger/remittance/${id}/correct`, data),
  voidRemittance: (id: string, data: VoidRemittancePayload) =>
    apiClient.patch(`/van-cash-ledger/remittance/${id}/void`, data),
};
