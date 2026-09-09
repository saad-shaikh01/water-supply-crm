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
  | 'CASH_OUT';

export type CashLedgerRowStatus = 'PENDING' | 'APPROVED' | null;

export interface CashLedgerRow {
  id: string;
  date: string;
  type: CashLedgerRowType;
  vanId: string | null;
  vanPlateNumber: string | null;
  title: string;
  /** Signed — positive for IN/opening, negative for OUT. */
  amount: number;
  /** Cumulative, server-computed. */
  runningBalance: number;
  /** Only meaningful for CASH_IN / CASH_IN_CORRECTION. */
  status: CashLedgerRowStatus;
  /** The VanCashHandover id, for the approve action. */
  sourceRecordId: string | null;
  dailySheetId: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
  sourceBadge: string;
  /** Optimistic-concurrency token for the approve action — null where not applicable (opening balance / cash-out rows). */
  version: number | null;
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
};
