/**
 * Cash Ledger P1 — wire contract additions. These mirror, field for field, the
 * types in `apps/vendor-dashboard/src/features/van-cash-ledger/api/
 * van-cash-ledger.api.ts` (`CashLedgerRowV2`, `CashLedgerDayStatement`,
 * `CashLedgerStatementTotals`, `CashLedgerSummary`, `SheetCashBreakdown`,
 * `CashLedgerTimelineMeta.dayStatements`). Types only — no runtime code.
 */

import type { CashLedgerBucket } from './cash-ledger-buckets';

/** IN = cash in, OUT = expense-type cash out, TRANSFER = owner transfer / fuel-card top-up (not a cost). */
export type CashLedgerDirection = 'IN' | 'OUT' | 'TRANSFER';

/** Optional categorisation of a manual cash-in (P2). Mirrors the Prisma `ManualCashInSource` enum. */
export type ManualCashInSource = 'OWNER_INJECTION' | 'OPENING_BALANCE' | 'REFUND' | 'BANK_WITHDRAWAL' | 'OTHER';

/**
 * Row v2 fields. Optional on the wire type (like the frontend mirror) so an
 * older client never breaks; the P1 server always sends every one of them
 * (see `VanCashLedgerRow extends Required<CashLedgerRowV2>`).
 */
export interface CashLedgerRowV2 {
  direction?: CashLedgerDirection;
  /** Who recorded the entry (creator / submitter / paid-by). */
  recordedByName?: string | null;
  /**
   * Whole vendor-calendar (Asia/Karachi) days between the business `date` and
   * `createdAt`: 0 = recorded the same day; N > 0 = backdated by N days;
   * N < 0 = future-dated.
   */
  lagDays?: number;
  /** True once the record was changed after creation (P1: plain Expense edits only). */
  isEdited?: boolean;
  lastEditedAt?: string | null;
  notes?: string | null;
  reference?: string | null;
  /** Never the attachment key itself — only whether one exists. */
  hasAttachment?: boolean;
  employeeId?: string | null;
  extraLabourId?: string | null;
  extraLabourName?: string | null;
  /** Handover rows only — the SHEET-derived figure. `amount` is the final approved figure. */
  expectedAmount?: number | null;
  /** Handover rows only — `amount − expectedAmount`. */
  variance?: number | null;
  voidedAt?: string | null;
  voidedByName?: string | null;
  /**
   * Per-row permission AND not already voided: crew cash -> crew_cash:delete;
   * fuel top-up -> fuel_cards:topup_void; manual cash-in (OPENING_BALANCE) ->
   * van_cash_ledger:manage (P2).
   */
  canVoid?: boolean;
  /**
   * P2 — may the current user edit this row in place? OPENING_BALANCE ->
   * van_cash_ledger:manage & ACTIVE; STANDALONE_CREW_CASH_OUT -> crew_cash:edit &
   * ACTIVE & payroll twin unlocked. Everything else false.
   */
  canEdit?: boolean;
  /** Why `canEdit` is false when the block is explainable (crew cash whose payroll twin is locked). */
  editBlockedReason?: string | null;
  /** Manual cash-in only (null elsewhere). */
  source?: ManualCashInSource | null;
  /** P3 filter support — id of the person `recordedByName` names (creator / submitter / paid-by). */
  recordedById?: string | null;
  /** P3 filter support — id of the approver (handover / owner transfer), null elsewhere. */
  approvedById?: string | null;
  /** Owner transfer only — the destination (null elsewhere). */
  destination?: CashLedgerRemittanceDestination | null;
  /** P4 — true when the row's business `date` falls in a CLOSED accounting period. */
  periodClosed?: boolean;
  /** P4 — "YYYY-MM" accounting period the row's business `date` (PKT) belongs to. */
  periodLabel?: string;
  /** P4 — the caller holds `van_cash_ledger:override_lock` (only ever true on a `periodClosed` page). */
  canOverride?: boolean;
  /**
   * P4 — handover-family rows only: when a system/approval-time posting was
   * redirected out of a closed period, the ORIGINAL business date (ISO) it is
   * "for"; `date` is then the current-period date it counts in. Null elsewhere.
   */
  relatesToDate?: string | null;
}

export type CashLedgerRemittanceDestination = 'OWNER' | 'CEO' | 'BANK' | 'OTHER';

/** Row status used by the P3 status filter. PENDING rows only appear when this filter asks for them. */
export type CashLedgerStatusFilter = 'PENDING' | 'APPROVED' | 'VOIDED' | 'CORRECTED';

/**
 * P3 timeline entry filters. Groups combine with AND, values inside an array
 * with OR. NONE of them changes a row's running balance or the per-day
 * statements (the server folds the whole date+van window first, filters after).
 * Mirrors `CashLedgerTimelineFilters` in the vendor-dashboard api file.
 */
export interface CashLedgerTimelineFilters {
  q?: string;
  buckets?: CashLedgerBucket[];
  status?: CashLedgerStatusFilter[];
  /** Recorded (createdAt) window, PKT YYYY-MM-DD, inclusive. */
  recordedFrom?: string;
  recordedTo?: string;
  backdatedOnly?: boolean;
  editedOnly?: boolean;
  recordedById?: string;
  approvedById?: string;
  employeeId?: string;
  /** Extra Labour — an `ExtraLabour` id (distinct from `employeeId`, a `User` id). OFFICE_EXPENSE rows only. */
  extraLabourId?: string;
  categories?: string[];
  minAmount?: number;
  maxAmount?: number;
  hasAttachment?: boolean;
  hasNote?: boolean;
  sheet?: string;
  reference?: string;
  destination?: CashLedgerRemittanceDestination;
}

/** `meta.filtered` — present only when a P3 filter is active. Cash-out is a positive magnitude. */
export interface CashLedgerFilteredMeta {
  active: boolean;
  count: number;
  totalIn: number;
  totalOut: number;
}

/** The reconciliation equation for one scope (range / day). Cash-out figures are positive magnitudes. */
export interface CashLedgerStatementTotals {
  sheetCashIn: number;
  officeCashIn: number;
  totalCashIn: number;
  officeExpenses: number;
  payrollCash: number;
  crewCash: number;
  /** officeExpenses + payrollCash + crewCash. Transfers are NOT expenses. */
  totalExpenses: number;
  ownerTransfer: number;
  fuelCard: number;
  net: number;
}

export interface CashLedgerDayStatement extends CashLedgerStatementTotals {
  /** PKT calendar day, YYYY-MM-DD. */
  date: string;
  /** Expected closing of the previous day (brought-forward for the first day of the window). */
  opening: number;
  /** opening + net. */
  closing: number;
  /** Ledger entries dated this day (voided included). */
  entryCount: number;
  /** Entries dated this day but recorded on a LATER vendor day (lagDays > 0). */
  lateCount: number;
}

/** GET /van-cash-ledger/summary */
export interface CashLedgerSummary {
  scope: 'OFFICE' | 'VAN';
  range: { from: string | null; to: string | null };
  statement: CashLedgerStatementTotals & {
    broughtForward: number;
    /** broughtForward + net. */
    expectedClosing: number;
  };
  /** Live, all-time balance (never date-scoped). */
  availableBalance: number;
  memo: {
    pendingHandovers: { count: number; amount: number };
    pendingRemittances: { count: number; amount: number };
    pendingAdvances: { count: number; amount: number };
    /** Σ(amount − expectedAmount) over approved handover rows dated in range. */
    approvalAdjustments: number;
    sheetBreakdown: {
      sheets: number;
      collected: number;
      expenses: number;
      crewCash: number;
      net: number;
      other: number;
    };
    firstNegativeDate: string | null;
  };
  trend: Array<{ date: string; closing: number }>;
}

/** GET /van-cash-ledger/sheets/:sheetId/cash-breakdown */
export interface SheetCashBreakdown {
  dailySheetId: string;
  sheetShortId: string;
  sheetDate: string;
  collected: number;
  expenses: number;
  crewCash: number;
  /** collected − expenses − crewCash, floored at 0. */
  netFromSheet: number;
  /** expected − netFromSheet. */
  other: number;
  expected: number;
  approved: number;
  variance: number;
  adjustmentReason: string | null;
  approvedByName: string | null;
}

// ── History (P2) — reuses the generic AuditLog ──────────────────────────────

export type CashLedgerHistoryAction = 'CREATED' | 'UPDATED' | 'APPROVED' | 'CORRECTED' | 'VOIDED' | 'REVERSED' | 'OTHER';

export type CashLedgerHistoryChangeKind = 'money' | 'date' | 'text' | 'status' | 'boolean';

/** One changed field of an event, already labelled/normalised for a before -> after display. */
export interface CashLedgerHistoryChange {
  field: string;
  label: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  kind: CashLedgerHistoryChangeKind;
}

export interface CashLedgerHistoryEvent {
  id: string;
  action: CashLedgerHistoryAction;
  /** ISO instant the event happened. */
  at: string;
  actorName: string | null;
  reason: string | null;
  summary: string;
  changes: CashLedgerHistoryChange[];
  /** RECORD = synthesised from the record's own createdAt/creator (no audit row exists for creation). */
  source: 'AUDIT_LOG' | 'RECORD' | 'STAFF_LEDGER_AUDIT';
}

/** GET /van-cash-ledger/entries/:sourceType/:sourceRecordId/history — newest event first. */
export interface CashLedgerHistoryResponse {
  entry: {
    sourceType: string;
    sourceRecordId: string;
    title: string;
    amount: number;
    date: string;
    createdAt: string;
    recordedByName: string | null;
    status: string | null;
    isVoided: boolean;
  };
  events: CashLedgerHistoryEvent[];
}

// ── Table view: GET /van-cash-ledger/daily-summary (P3) ─────────────────────

export type CashLedgerSummaryGroup = 'day' | 'week' | 'month';

export interface CashLedgerDailySummaryQuery {
  vanId?: string;
  from?: string;
  to?: string;
  group?: CashLedgerSummaryGroup;
  /** Include zero-activity days/weeks (balance carries across them). Default false. */
  includeEmpty?: boolean;
}

/**
 * One table row: the reconciliation equation for a day (or a week / month when
 * grouped). Statements are ALWAYS the true date+van scope figures — entry
 * filters never apply here. Cash-out figures are positive magnitudes.
 */
export interface CashLedgerPeriodRow extends CashLedgerStatementTotals {
  /** day -> YYYY-MM-DD; week -> the Monday YYYY-MM-DD; month -> YYYY-MM. */
  key: string;
  /** Display label, e.g. "Wed, 8 Jul 2026" / "6 – 12 Jul 2026" / "Jul 2026". */
  label: string;
  /** Inclusive PKT bounds of the bucket, clamped to the requested range. */
  from: string;
  to: string;
  opening: number;
  closing: number;
  /** Ledger entries dated in the bucket (voided included). */
  entryCount: number;
  /** Entries RECORDED (createdAt) in the bucket — among the window's rows. */
  recordedCount: number;
  /** Entries dated in the bucket but recorded on a later PKT day. */
  lateCount: number;
  editedCount: number;
  voidedCount: number;
  /** Pending sheet handovers + owner transfers dated in the bucket (memo — not in balance). */
  pendingCount: number;
  isEmpty: boolean;
}

export interface CashLedgerDailySummary {
  group: CashLedgerSummaryGroup;
  scope: 'OFFICE' | 'VAN';
  range: { from: string | null; to: string | null };
  /** Newest first. */
  rows: CashLedgerPeriodRow[];
  /** Whole-range statement — equals `GET /summary`'s statement for the same range (invariant I1). */
  totals: CashLedgerStatementTotals & {
    broughtForward: number;
    expectedClosing: number;
    entryCount: number;
    lateCount: number;
    pendingCount: number;
  };
  /** true when the range produced more than the server's row cap (366) and the oldest rows were dropped. */
  truncated: boolean;
}

// ── Accounting periods (P4) ─────────────────────────────────────────────────
// Mirrors the frontend's `van-cash-ledger.api.ts` (Accounting periods section).

/** Header carrying the mandatory reason when an admin knowingly writes into a CLOSED period. */
export const LOCK_OVERRIDE_HEADER = 'X-Lock-Override-Reason';

/**
 * Body of the 403 the server returns for a write dated inside a closed period.
 * `canOverride` = the caller holds `van_cash_ledger:override_lock`; when true the
 * client may replay the SAME request with `LOCK_OVERRIDE_HEADER` (reason ≥ 10 chars).
 */
export interface PeriodClosedErrorBody {
  statusCode: number;
  code: 'PERIOD_CLOSED';
  message: string;
  /** Closed period labels ("YYYY-MM") the write touches. */
  periods: string[];
  canOverride: boolean;
}

export interface CashLedgerPeriodInfo {
  /** "YYYY-MM" (Asia/Karachi calendar month). */
  label: string;
  /** e.g. "Aug 2026". */
  displayLabel: string;
  /** PKT YYYY-MM-DD bounds (inclusive). */
  firstDay: string;
  lastDay: string;
  status: 'OPEN' | 'CLOSED';
  isCurrent: boolean;
  /** Today is after the period's last day (only ended periods can be closed). */
  hasEnded: boolean;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  reopenCount: number;
  /** Writes made into this period while closed (admin overrides). */
  overrideCount: number;
  lastOverrideAt: string | null;
  /** Office-wide expected closing cash AS CLOSED (null while open). */
  closingBalance: number | null;
  /** Live office-wide closing balance at the END of this period (everything dated up to its last day). */
  liveClosingBalance: number;
  /** liveClosingBalance − closingBalance; 0 = unchanged since close; null while open. */
  drift: number | null;
  /** CLOSED and no later period is closed (only the most recent closed period can be reopened). */
  canReopen: boolean;
}

/** GET /van-cash-ledger/periods — newest first, from the current month back to the earliest ledger activity (max 24). */
export interface CashLedgerPeriodsResponse {
  currentLabel: string;
  periods: CashLedgerPeriodInfo[];
  /** Server-resolved permissions of the caller. */
  permissions: { canClose: boolean; canOverride: boolean };
}

export interface PeriodCheckItem {
  code: string;
  message: string;
  count: number;
  amount?: number | null;
}

/** GET /van-cash-ledger/periods/:label/close-check */
export interface CashLedgerPeriodCloseCheck {
  label: string;
  displayLabel: string;
  firstDay: string;
  lastDay: string;
  status: 'OPEN' | 'CLOSED';
  canClose: boolean;
  /** Must be zero to close. */
  blockers: PeriodCheckItem[];
  /** Closing needs `acknowledgeWarnings: true` when any. */
  warnings: PeriodCheckItem[];
  /** The statement that would be snapshotted (office-wide). */
  statement: CashLedgerStatementTotals & { broughtForward: number; expectedClosing: number };
}

export interface ClosePeriodPayload {
  note?: string;
  acknowledgeWarnings?: boolean;
}

export interface ReopenPeriodPayload {
  /** Mandatory, ≥ 10 chars. */
  reason: string;
}
