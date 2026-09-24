import { apiClient } from '@water-supply-crm/data-access';
import { filenameFromContentDisposition } from '../lib/download-file';

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
  | 'CASH_REMITTANCE_OUT'
  | 'FUEL_CARD_TOPUP_OUT'
  | 'STANDALONE_CREW_CASH_OUT'
  | 'PAYROLL_SETTLEMENT_OUT';

/**
 * Server-assigned accounting bucket a row is counted under in the stats
 * (Sheet cash in / Office cash in / Office expense / Payroll cash / Crew cash /
 * Owner transfer / Fuel card).
 */
export type CashLedgerBucket =
  | 'SHEET_CASH_IN'
  | 'OFFICE_CASH_IN'
  | 'OFFICE_EXPENSE'
  | 'PAYROLL_CASH'
  | 'CREW_CASH'
  | 'OWNER_TRANSFER'
  | 'FUEL_CARD';

export type CashLedgerRowStatus = 'PENDING' | 'APPROVED' | null;

/** IN = cash in, OUT = expense-type cash out, TRANSFER = owner transfer / fuel-card top-up (not a cost). */
export type CashLedgerDirection = 'IN' | 'OUT' | 'TRANSFER';

/**
 * Row v2 fields (P1). All optional on the wire type so a stale cache / older
 * server never breaks the UI; the P1 server always sends them.
 */
export interface CashLedgerRowV2 {
  direction?: CashLedgerDirection;
  /** Who recorded the entry (creator / submitter / paid-by) — the "Recorded … by X" line. */
  recordedByName?: string | null;
  /**
   * Whole vendor-calendar (Asia/Karachi) days between the business `date` and
   * `createdAt`: 0 = recorded the same day; N > 0 = backdated by N days;
   * N < 0 = future-dated (recorded before the business date).
   */
  lagDays?: number;
  /** True once the record was changed after creation (P1: plain Expense edits only; P2 widens it). */
  isEdited?: boolean;
  lastEditedAt?: string | null;
  notes?: string | null;
  reference?: string | null;
  hasAttachment?: boolean;
  employeeId?: string | null;
  extraLabourId?: string | null;
  extraLabourName?: string | null;
  /** Handover rows only — the SHEET-derived figure (what the sheet said). `amount` is the final approved figure. */
  expectedAmount?: number | null;
  /** Handover rows only — `amount − expectedAmount` (negative = approved less than the sheet said). 0/null when none. */
  variance?: number | null;
  voidedAt?: string | null;
  voidedByName?: string | null;
  /**
   * Server-computed per-row permission AND the row is not already voided:
   * crew cash → crew_cash:delete; fuel top-up → fuel_cards:topup_void;
   * manual cash-in (OPENING_BALANCE) → van_cash_ledger:manage (P2).
   */
  canVoid?: boolean;
  /**
   * P2 — may this row be edited in place by the current user?
   * OPENING_BALANCE → van_cash_ledger:manage & ACTIVE; STANDALONE_CREW_CASH_OUT →
   * crew_cash:edit & ACTIVE & payroll twin unlocked. Everything else false/omitted
   * (Expense/fuel/service rows keep their existing Expense-drawer edit flow).
   */
  canEdit?: boolean;
  /** Why `canEdit` is false when the block is explainable (crew cash whose payroll twin is locked → "void and re-record"). */
  editBlockedReason?: string | null;
  /** Manual cash-in only. */
  source?: ManualCashInSource | null;
  /**
   * P4 — the row's business date falls in a CLOSED accounting period. Writes to
   * it are rejected unless the user holds `van_cash_ledger:override_lock` (then
   * `canOverride` is true and the UI asks for a reason via the override dialog).
   */
  periodClosed?: boolean;
  /** "YYYY-MM" of the row's period (always set by the P4 server). */
  periodLabel?: string;
  /** The current user holds `van_cash_ledger:override_lock`. */
  canOverride?: boolean;
  /**
   * P4 redirect rule — set when a system / approval-time posting that belongs to
   * a CLOSED period landed in the current one: `date` is the current-period date
   * it counts in, `relatesToDate` is the original business date ("for 12 Aug").
   */
  relatesToDate?: string | null;
}

export type ManualCashInSource =
  | 'OWNER_INJECTION'
  | 'OPENING_BALANCE'
  | 'REFUND'
  | 'BANK_WITHDRAWAL'
  | 'OTHER'
  | 'VEHICLE_RENTED_OUT'
  | 'LABOUR_LENT_OUT';

export interface CashLedgerRow extends CashLedgerRowV2 {
  id: string;
  date: string;
  type: CashLedgerRowType;
  vanId: string | null;
  vanPlateNumber: string | null;
  /** OPENING_BALANCE (source VEHICLE_RENTED_OUT) only — the Fleet vehicle this rent income is attributed to. */
  vehicleId?: string | null;
  vehiclePlateNumber?: string | null;
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
  /** CASH_REMITTANCE_OUT / FUEL_CARD_TOPUP_OUT / STANDALONE_CREW_CASH_OUT only — true when the row has been voided (shown struck-through, folds in as 0). */
  isVoided?: boolean;
  /** CASH_REMITTANCE_OUT / FUEL_CARD_TOPUP_OUT / STANDALONE_CREW_CASH_OUT only — the reason captured when the row was voided. */
  voidReason?: string | null;
  /** CASH_REMITTANCE_OUT only — true when this row is a DELTA correction row, not the root of a logical remittance. */
  isCorrection?: boolean;
  /** P3 filter support — who recorded / approved it (ids; names are `recordedByName` / `approvedByName`). */
  recordedById?: string | null;
  approvedById?: string | null;
  /** CASH_REMITTANCE_OUT only — the owner-transfer destination. */
  destination?: RemittanceDestination | null;
  /**
   * CASH_OUT only — mirrors the Expense Center's own `ExpenseCenterRow` shape
   * so the Cash Ledger timeline can reuse its detail drawer / edit routing
   * verbatim (see `expense-center.api.ts`). `undefined` for every other row type.
   */
  sourceType?: string;
  domain?: string;
  category?: string;
  categoryLabel?: string;
  costSign?: 'DEBIT' | 'CREDIT';
  paidFromCash?: boolean | null;
  employeeName?: string | null;
  locked?: boolean;
  lockedReason?: string | null;
  /** Accounting bucket this row is counted under. Optional until the backend deploy is live. */
  bucket?: CashLedgerBucket;
  /** When the underlying record was created (ISO) — used to order rows that share a `date`. */
  createdAt?: string;
}

/** Row status used by the status filter. PENDING rows (handovers / owner transfers awaiting approval) only appear when this filter asks for them. */
export type CashLedgerStatusFilter = 'PENDING' | 'APPROVED' | 'VOIDED' | 'CORRECTED';

/**
 * P3 entry filters (timeline). Groups combine with AND, values inside an array
 * with OR. NONE of them changes any row's running balance or the per-day
 * statements (those always describe the full date+van scope — the server folds
 * the whole window first and filters afterwards).
 */
export interface CashLedgerTimelineFilters {
  /** Server-side search over title, notes, reference, employee, van plate, category label, recorded-by, sheet id. ≥ 2 chars. */
  q?: string;
  buckets?: CashLedgerBucket[];
  status?: CashLedgerStatusFilter[];
  /** Recorded (createdAt) window, PKT YYYY-MM-DD, inclusive. */
  recordedFrom?: string;
  recordedTo?: string;
  /** lagDays > 0 */
  backdatedOnly?: boolean;
  editedOnly?: boolean;
  recordedById?: string;
  approvedById?: string;
  /** Crew-cash / payroll employee OR the handover's submitting driver. */
  employeeId?: string;
  /** Extra Labour — an ExtraLabour id (distinct from employeeId, a User id). OFFICE_EXPENSE rows only. */
  extraLabourId?: string;
  /** A Fleet Vehicle id — OFFICE_CASH_IN rows with source VEHICLE_RENTED_OUT only. */
  vehicleId?: string;
  /** Row `category` values (ExpenseCategory / StaffLedgerCategory / CrewCashCategory). */
  categories?: string[];
  minAmount?: number;
  maxAmount?: number;
  hasAttachment?: boolean;
  hasNote?: boolean;
  /** Daily Sheet number — matches the short id (prefix, case-insensitive). */
  sheet?: string;
  reference?: string;
  /** Owner-transfer destination. */
  destination?: RemittanceDestination;
}

export interface CashLedgerTimelineQuery extends CashLedgerTimelineFilters {
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
  /** Balance carried into the first day of the requested range (everything before `from`). */
  broughtForward?: number;
  /**
   * Per-day statement for every business day that appears on the returned page,
   * keyed by PKT `YYYY-MM-DD`. Totals cover the WHOLE day (not just this page's
   * rows), so a day split across "load more" pages still shows correct numbers.
   */
  dayStatements?: Record<string, CashLedgerDayStatement>;
  /**
   * Present when any P3 entry filter is active: subtotal of the FILTERED rows
   * (`total` above is also the filtered count). Cash-out figures are positive
   * magnitudes; voided/pending rows contribute 0.
   */
  filtered?: { active: boolean; count: number; totalIn: number; totalOut: number };
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
  /** Expected closing of the previous day (brought-forward for the first day of the range). */
  opening: number;
  /** Expected closing cash: opening + totalCashIn − totalExpenses − ownerTransfer − fuelCard. */
  closing: number;
  /** Ledger entries dated this day (voided included). */
  entryCount: number;
  /** Entries dated this day but recorded on a LATER vendor day (lagDays > 0). */
  lateCount: number;
}

/** GET /van-cash-ledger/summary */
export interface CashLedgerSummary {
  /** VAN when a van is selected (office-wide tiers are hidden), else OFFICE. */
  scope: 'OFFICE' | 'VAN';
  range: { from: string | null; to: string | null };
  statement: CashLedgerStatementTotals & {
    broughtForward: number;
    /** broughtForward + net = expected closing cash for the range. */
    expectedClosing: number;
  };
  /** Live, all-time balance (never date-scoped). */
  availableBalance: number;
  memo: {
    /** Approved-nothing-yet money "in transit": handovers awaiting approval. */
    pendingHandovers: { count: number; amount: number };
    pendingRemittances: { count: number; amount: number };
    /** Payroll advances still PENDING approval — cash may already have left the office. */
    pendingAdvances: { count: number; amount: number };
    /** Σ(amount − expectedAmount) over approved handover rows dated in range. Negative = approved less than sheets said. */
    approvalAdjustments: number;
    /** Aggregated Sheet Cash Breakdown for the approved (non-correction) handovers dated in range. */
    sheetBreakdown: {
      sheets: number;
      collected: number;
      expenses: number;
      /** Crew cash paid on sheets — already inside Sheet Cash In, NEVER a ledger row. */
      crewCash: number;
      /** collected − expenses − crewCash (per sheet, floored at 0 like the sheet itself), summed. */
      net: number;
      /** expected − net: sheet corrections / rounding so the breakdown always balances. */
      other: number;
    };
    /** First PKT day in range whose closing balance is negative. */
    firstNegativeDate: string | null;
  };
  /** Daily expected-closing series (days with activity) for the sparkline. */
  trend: Array<{ date: string; closing: number }>;
}

// ── History (P2) — reuses the generic AuditLog (+ the payroll twin's own audit) ──

export type CashLedgerHistoryAction = 'CREATED' | 'UPDATED' | 'APPROVED' | 'CORRECTED' | 'VOIDED' | 'REVERSED' | 'OTHER';

export type CashLedgerHistoryChangeKind = 'money' | 'date' | 'text' | 'status' | 'boolean';

/** One changed field of an event, already labelled/normalised by the server for a before → after display. */
export interface CashLedgerHistoryChange {
  field: string;
  /** Human label, e.g. "Amount", "Date", "Van", "Note". */
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
  /** Mandatory reason captured for edits / voids / adjustments (null for plain creates). */
  reason: string | null;
  /** One-line human summary, e.g. "Amount changed ₨10,000 → ₨12,000". */
  summary: string;
  changes: CashLedgerHistoryChange[];
  /** RECORD = synthesised from the record's own createdAt/createdBy (no audit row exists for creation). */
  source: 'AUDIT_LOG' | 'RECORD' | 'STAFF_LEDGER_AUDIT';
}

/** GET /van-cash-ledger/entries/:sourceType/:sourceRecordId/history — newest event first. */
export interface CashLedgerHistoryResponse {
  /** Minimal header so the drawer works from a deep link even when the row isn't in a loaded page. */
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

export interface EditManualCashInPayload {
  /** Optimistic-concurrency token — the row's current `version`. */
  version: number;
  amount?: number;
  /** YYYY-MM-DD. Future dates are rejected. */
  date?: string;
  /** `null` = detach from any van (office-wide). Omit = unchanged. */
  vanId?: string | null;
  note?: string;
  source?: ManualCashInSource | null;
  /** `null` detaches the vehicle attribution. Omit = unchanged. */
  relatedVehicleId?: string | null;
  /** `null` detaches the employee attribution. Omit = unchanged. */
  relatedEmployeeId?: string | null;
  /** Mandatory (≥ 5 chars) — kept in the audit trail. */
  reason: string;
}

export interface VoidManualCashInPayload {
  version: number;
  /** Mandatory (≥ 5 chars). */
  reason: string;
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
  /** day → YYYY-MM-DD; week → the Monday YYYY-MM-DD; month → YYYY-MM. */
  key: string;
  /** Display label, e.g. "Wed, 8 Jul 2026" / "6 – 12 Jul 2026" / "Jul 2026". */
  label: string;
  /** Inclusive PKT bounds of the bucket, clamped to the requested range. Feed to the day drawer / "Open in timeline". */
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
  /** PKT YYYY-MM-DD bounds (inclusive) — feed straight into from/to. */
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
  /** liveClosingBalance − closingBalance; 0 = unchanged since close; null while open. Drives the "As closed / Now" chip. */
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
  /** Must be zero to close (period not ended, earlier period still open, pending handovers/transfers…). */
  blockers: PeriodCheckItem[];
  /** Closing needs `acknowledgeWarnings: true` when any (open sheets, pending advances, negative balance…). */
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

/** GET /van-cash-ledger/sheets/:sheetId/cash-breakdown */
export interface SheetCashBreakdown {
  dailySheetId: string;
  sheetShortId: string;
  sheetDate: string;
  collected: number;
  expenses: number;
  crewCash: number;
  /** collected − expenses − crewCash, floored at 0 (the sheet's own "net to hand in"). */
  netFromSheet: number;
  /** expectedAmount − netFromSheet (sheet corrections after close etc.); 0 when it balances. */
  other: number;
  /** Chain totals across the sheet's non-voided handover rows. */
  expected: number;
  approved: number;
  variance: number;
  adjustmentReason: string | null;
  approvedByName: string | null;
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

/**
 * Month-wise Plant/Caps bill status (owner request 2026-09-22) — mirrors
 * SupplierBillService's `SupplierBillBucket`/`SupplierBillStatus` on the
 * backend exactly.
 */
export interface SupplierBillBucket {
  prevMonthPending: number;
  currentMonthBill: number;
  currentMonthPending: number;
  totalPending: number;
  /** Bottles that actually contributed to `prevMonthPending`'s originating bill (owner request 2026-09-23). */
  prevMonthBottles: number;
  /** Bottles that actually contributed to `currentMonthBill`. */
  currentMonthBottles: number;
}

export interface SupplierBillStatus {
  periodLabel: string;
  plant: SupplierBillBucket;
  caps: SupplierBillBucket;
}

export interface CashLedgerStats {
  /** Date-range scoped — office expenses + payroll cash + crew cash. */
  totalExpense: number;
  /** Date-range scoped — sheet cash in + manual (office) cash in. */
  totalCashIn: number;
  /** NOT date-range scoped — the true current balance. */
  availableBalance: number;
  pendingHandoverCount: number;
  /** Date-range scoped — sum of APPROVED office→owner remittances in the window. */
  totalRemitted: number;
  /** NOT date-range scoped — count of PENDING office→owner remittances awaiting approval. */
  pendingRemittanceCount: number;
  /** Date-range scoped — sum of ACTIVE (non-voided) fuel card top-ups in the window. */
  totalFuelCardTopUps: number;
  /** Date-range scoped — sum of ACTIVE (non-voided) standalone (no Daily Sheet) crew cash in the window. */
  totalStandaloneCrewCash: number;
  /** Date-range scoped — APPROVED driver handovers from Daily Sheets. */
  sheetCashIn?: number;
  /** Date-range scoped — manual cash-in entries (owner top-ups, opening balance, etc). */
  officeCashIn?: number;
  /** Date-range scoped — cash-paid office expenses (fuel logs, services, general expenses). */
  officeExpenses?: number;
  /** Date-range scoped — payroll / salary settlements paid in cash. */
  payrollCash?: number;
  /** Date-range scoped — crew cash paid out (sheet-linked and standalone). */
  crewCash?: number;
  /** Balance carried into the first day of the range (everything before `from`). */
  broughtForward?: number;
  /** `broughtForward` + cash in − cash out − remitted − fuel card top-ups for the range. */
  expectedClosing?: number;
}

export interface PendingHandoverQuery {
  vanId?: string;
}

export interface PendingHandover {
  id: string;
  dailySheetId: string;
  vanPlateNumber: string;
  driverName: string;
  /** Sheet's confirmed salesman crew member, if any. */
  salesmanName: string | null;
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

export interface AddCashInPayload {
  /** Omit for a general/office-wide entry (only counted in the "All Vans" view). */
  vanId?: string;
  openingBalance: number;
  openingDate: string;
  note?: string;
  /** Optional categorisation (P2) for "Office Cash In by source" reporting. */
  source?: ManualCashInSource;
  /** Required when source is VEHICLE_RENTED_OUT — the vehicle that earned the rent. */
  relatedVehicleId?: string;
  /** Required when source is LABOUR_LENT_OUT — the employee who was lent out. */
  relatedEmployeeId?: string;
}

export interface ApproveHandoverPayload {
  version: number;
  approvedAmount?: number;
  adjustmentReason?: string;
}

// ── Exports (P5) — permission `van_cash_ledger:export` ───────────────────────

/** `GET /export/timeline.csv` — the timeline's filters, but never paged (server caps at 50,000 rows). */
export type CashLedgerTimelineExportQuery = Omit<CashLedgerTimelineQuery, 'page' | 'limit'>;

/** `GET /export/daily.csv` — same shape as the daily-summary query. */
export type CashLedgerDailyExportQuery = CashLedgerDailySummaryQuery;

/** `GET /reports/daily.pdf` — `date` is a PKT YYYY-MM-DD (never in the future); `vanId` omitted = office-wide. */
export interface CashLedgerDailyReportQuery {
  date: string;
  vanId?: string;
}

/** A downloaded file, ready for `saveBlob`. `truncated` = the server hit its 50,000-row cap (`X-Export-Truncated`). */
export interface CashLedgerDownload {
  blob: Blob;
  filename: string;
  truncated: boolean;
}

/** "2026-09-01_to_2026-09-18", "2026-09-18" (single day), "from-…" / "until-…", or "all-dates". */
function rangeSlug(from?: string, to?: string): string {
  if (from && to) return from === to ? from : `${from}_to_${to}`;
  if (from) return `from-${from}`;
  if (to) return `until-${to}`;
  return 'all-dates';
}

/** Drops undefined / '' / false / [] so the query string only carries real filters. */
function compactParams<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => {
      if (v === undefined || v === null || v === false) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }),
  ) as Partial<T>;
}

async function fetchDownload(url: string, params: object, fallbackFilename: string): Promise<CashLedgerDownload> {
  const res = await apiClient.get<Blob>(url, { params: compactParams(params), responseType: 'blob' });
  const headers = res.headers as Record<string, string | undefined>;
  return {
    blob: res.data,
    filename: filenameFromContentDisposition(headers['content-disposition'], fallbackFilename),
    truncated: String(headers['x-export-truncated'] ?? '').toLowerCase() === 'true',
  };
}

export const vanCashLedgerApi = {
  exportTimelineCsv: (params: CashLedgerTimelineExportQuery = {}) =>
    fetchDownload(
      '/van-cash-ledger/export/timeline.csv',
      params,
      `cash-ledger-${rangeSlug(params.from, params.to)}.csv`,
    ),
  exportDailyCsv: (params: CashLedgerDailyExportQuery = {}) =>
    fetchDownload(
      '/van-cash-ledger/export/daily.csv',
      params,
      `cash-ledger-daily-${params.group ?? 'day'}-${rangeSlug(params.from, params.to)}.csv`,
    ),
  downloadDailyReportPdf: ({ date, vanId }: CashLedgerDailyReportQuery) =>
    fetchDownload('/van-cash-ledger/reports/daily.pdf', { date, vanId }, `cash-report-${date}.pdf`),

  editManualCashIn: (id: string, data: EditManualCashInPayload) =>
    apiClient.patch(`/van-cash-ledger/manual-cash-in/${id}`, data),
  voidManualCashIn: (id: string, data: VoidManualCashInPayload) =>
    apiClient.patch(`/van-cash-ledger/manual-cash-in/${id}/void`, data),
  getEntryHistory: (sourceType: string, sourceRecordId: string) =>
    apiClient.get<CashLedgerHistoryResponse>(
      `/van-cash-ledger/entries/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceRecordId)}/history`,
    ),
  addCashIn: (data: AddCashInPayload) =>
    apiClient.post('/van-cash-ledger/manual-cash-in', data),
  getTimeline: (params: CashLedgerTimelineQuery) =>
    apiClient.get<CashLedgerTimelineResponse>('/van-cash-ledger/timeline', { params }),
  getPeriods: () => apiClient.get<CashLedgerPeriodsResponse>('/van-cash-ledger/periods'),
  getPeriodCloseCheck: (label: string) =>
    apiClient.get<CashLedgerPeriodCloseCheck>(`/van-cash-ledger/periods/${label}/close-check`),
  closePeriod: (label: string, data: ClosePeriodPayload) =>
    apiClient.post<CashLedgerPeriodInfo>(`/van-cash-ledger/periods/${label}/close`, data),
  reopenPeriod: (label: string, data: ReopenPeriodPayload) =>
    apiClient.post<CashLedgerPeriodInfo>(`/van-cash-ledger/periods/${label}/reopen`, data),
  getDailySummary: (params?: CashLedgerDailySummaryQuery) =>
    apiClient.get<CashLedgerDailySummary>('/van-cash-ledger/daily-summary', { params }),
  getSummary: (params?: CashLedgerStatsQuery) =>
    apiClient.get<CashLedgerSummary>('/van-cash-ledger/summary', { params }),
  getSheetCashBreakdown: (dailySheetId: string) =>
    apiClient.get<SheetCashBreakdown>(`/van-cash-ledger/sheets/${dailySheetId}/cash-breakdown`),
  getStats: (params?: CashLedgerStatsQuery) =>
    apiClient.get<CashLedgerStats>('/van-cash-ledger/stats', { params }),
  getSupplierBills: () =>
    apiClient.get<SupplierBillStatus>('/van-cash-ledger/supplier-bills'),
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
