export type DeliveryStatusType =
  | 'PENDING'
  | 'COMPLETED'
  | 'EMPTY_ONLY'
  | 'NOT_AVAILABLE'
  | 'RESCHEDULED'
  | 'CANCELLED';

export type PaymentTypeValue = 'MONTHLY' | 'CASH';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductSummary {
  id: string;
  name: string;
  basePrice: number;
}

export interface BottleWallet {
  id: string;
  balance: number;
  productId: string;
  product: Pick<ProductSummary, 'id' | 'name'>;
}

export interface CustomPrice {
  id: string;
  customPrice: number;
  productId: string;
  product: Pick<ProductSummary, 'id' | 'name' | 'basePrice'>;
}

export interface DeliverySchedule {
  id: string;
  dayOfWeek: number;
  vanId: string;
  routeSequence: number | null;
  van: { id: string; plateNumber: string };
}

export interface CustomerDetail {
  id: string;
  name: string;
  customerCode: string;
  phoneNumber: string;
  address: string;
  floor: string | null;
  nearbyLandmark: string | null;
  deliveryInstructions: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  financialBalance: number;
  paymentType: PaymentTypeValue;
  isBillingExempt: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  routeId: string | null;
  route: { id: string; name: string } | null;
  wallets: BottleWallet[];
  customPrices: CustomPrice[];
  deliverySchedules: DeliverySchedule[];
  user: { id: string; email: string } | null;
}

export interface ConsumptionPeriod {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  days: number; // elapsed days used for per-day rates
  allTime: boolean;
}

export interface ConsumptionSummary {
  deliveryCount: number;
  totalFilledDropped: number;
  totalEmptyReceived: number;
  avgFilledPerDelivery: number;
  bottlesPerDay: number;
  avgDaysBetweenDeliveries: number | null;
}

export interface ConsumptionTrend {
  prevFrom: string;
  prevTo: string;
  prevBottlesPerDay: number;
  changePct: number | null;
}

export type ConsumptionRateStatus = 'ON_TARGET' | 'ATTENTION' | 'ACTION';

export interface ConsumptionByProduct {
  product: Pick<ProductSummary, 'id' | 'name'>;
  currentWalletBalance: number;
  periodEndWalletBalance: number;
  deliveryCount: number;
  totalConsumed: number;
  totalEmptyReceived: number;
  avgPerDelivery: number;
  bottlesPerDay: number;
  estStockDaysLeft: number | null;
  consumptionRate: string; // e.g. "82.5%" or "N/A"
  rateStatus: ConsumptionRateStatus | null;
}

export interface CustomerConsumption {
  customerId: string;
  customerName: string;
  period: ConsumptionPeriod;
  summary: ConsumptionSummary;
  byProduct: ConsumptionByProduct[];
  trend: ConsumptionTrend | null;
}

export interface CustomerScheduleItem {
  id: string;
  date: string | null;
  status: DeliveryStatusType;
  filledDropped: number;
  product: Pick<ProductSummary, 'name'> | null;
  dailySheet: { date: string } | null;
}

export interface CustomerWalletSummary {
  balance: number;
  productId: string;
  product: { name: string };
}

// Customer Communication Center (docs/features/customer-communication-center.md).
// ConversationMessage evolved from the old DeliveryItemNote table (Phase 1);
// the DeliveryItemNote alias itself was removed in Phase 7.
// Per-message delivery context — which delivery this specific message is
// about (Conversation is per-customer; a running thread can span many days).
export interface ConversationMessageItem {
  id: string;
  sequence: number;
  dailySheetId: string;
  dailySheet: { id: string; date: string; van: { plateNumber: string } };
}

export interface ConversationMessage {
  id: string;
  type: 'TEXT' | 'VOICE';
  text: string | null;
  audioKey: string | null;
  audioDuration: number | null;
  requiresAck: boolean;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  item: ConversationMessageItem;
}

export interface ConversationContext {
  id: string;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
  waitingOn: 'DRIVER' | 'OFFICE' | null;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  customer: { id: string; name: string; customerCode: string; phoneNumber: string | null };
  // Nullable: a freshly-created, unmessaged conversation (get-or-create with
  // zero sends) has none of this yet — it's the "most recently discussed
  // delivery" rollup, written only when a real message is sent.
  dailySheet: { id: string; date: string; isClosed: boolean } | null;
  van: { id: string; plateNumber: string } | null;
  driver: { id: string; name: string } | null;
  item: { id: string; sequence: number; status: DeliveryStatusType; product: { id: string; name: string } } | null;
}

export interface DeliveryItem {
  id: string;
  sequence: number;
  customerId: string;
  customer?: {
    name: string;
    address: string;
    customerCode: string;
    floor?: string | null;
    nearbyLandmark?: string | null;
    deliveryInstructions?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    phoneNumber?: string | null;
    paymentType?: PaymentTypeValue;
    isBillingExempt?: boolean;
    financialBalance?: number;
    previousMonthOutstanding?: number;
    consumptionRate30d?: number | null;
    wallets?: CustomerWalletSummary[];
    customPrices?: { productId: string; customPrice: number }[];
  };
  productId: string;
  product?: { name: string; basePrice?: number };
  status: DeliveryStatusType;
  filledDropped: number;
  emptyReceived: number;
  /** Already-filled bottles received back from the customer (account closing, excess stock return). */
  filledReceived: number;
  cashCollected: number;
  reason?: string | null;
  failureCategory?: string | null;
  photoKey?: string | null;
  pricePerBottle?: number;
  lastFilledDropped?: number | null;
  deliveredAt?: string | null;
  editUnlockedBy?: string | null;
  editUnlockExpiresAt?: string | null;
  editRequestedAt?: string | null;
  whatsappSentAt?: string | null;
  whatsappStatus?: 'SENT' | 'FAILED' | 'SKIPPED' | null;
  whatsappError?: string | null;
  bottleBalanceAfter?: number | null;
  financialBalanceAfter?: number | null;
  // Communication Center summary (Phase 7) — replaces the old full `notes`
  // array; ConversationThread fetches full message history itself when the
  // card is expanded. pendingAckCount alone drives the requiresAck delivery
  // gate and the row chip's "N Pending ⚠" state.
  messageCount?: number;
  pendingAckCount?: number;
  deliveryType?: 'SCHEDULED' | 'ON_DEMAND';
  sourceOrderId?: string | null;
  isCorrection?: boolean;
  correctionAddedAt?: string | null;
  correctionNote?: string | null;
  /** Bumped on each force-resubmit of a terminal-status item — drives the "Edited" row badge. */
  editCount?: number;
  lastEditedAt?: string | null;
  /** Trip this delivery was recorded during — null if no trip was active at record time (shown as "Unassigned"). */
  dailySheetLoadId?: string | null;
  /** Set only on items rendered via the source sheet's "Moved Out" tab (built
   * from DeliveryItemMoveLogEntry.item + its sibling fields) — where this
   * item is now and who sent it there. Absent everywhere else. */
  moveInfo?: {
    otherSheet: { id: string; date: string; van: { id: string; plateNumber: string } | null };
    movedBy: { id: string; name: string };
    movedAt: string;
  };
}

export interface CustomerFinancialSummary {
  currentMonthPaid: number;
  prevMonthOutstanding: number;
  currentOutstanding: number;
}

/** Vendor-configurable Monthly Customer Collection Policy (minimum-collection floor). */
export interface CollectionPolicy {
  enabled: boolean;
  minOutstandingThreshold: number;
  minCollectionPercentage: number;
  allowedShortfall: number;
}

/**
 * Result of evaluating a delivery's cash collected against the vendor's
 * CollectionPolicy. `applies=false` means the policy is exempt for this
 * submission (see `reason`); `applies=true && satisfied=false` means the
 * driver must collect at least `requiredAmount` or set cash to 0.
 */
export interface CollectionPolicyResult {
  applies: boolean;
  satisfied: boolean;
  reason?: 'DISABLED' | 'NOT_MONTHLY' | 'BILLING_EXEMPT' | 'ZERO_CASH' | 'BELOW_THRESHOLD' | 'BELOW_MINIMUM';
  requiredAmount: number;
  collectedAmount: number;
  remainingPreviousOutstanding: number;
}

/**
 * Vendor-configurable Cash Customer Collection Policy (proportional-settlement
 * credit control, docs/features/cash-customer-collection-policy.md). No stored
 * credit window — `allowedCreditDeliveries` (N) plus the customer's own live
 * balance/charge determine the required amount: required = exposure/(N+1),
 * rounded down to the nearest ₨10, with an optional absolute `maxOutstandingCeiling`.
 */
export interface CashCollectionPolicy {
  enabled: boolean;
  allowedCreditDeliveries: number;
  minExposureFloor: number;
  maxOutstandingCeiling: number | null;
}

/**
 * Result of evaluating a delivery's cash collected against the vendor's
 * CashCollectionPolicy. `applies=false` means the policy is exempt for this
 * submission (see `reason`); `applies=true && satisfied=false` means the
 * driver must collect at least `requiredAmount`.
 */
export interface CashCollectionPolicyResult {
  applies: boolean;
  satisfied: boolean;
  reason?: 'DISABLED' | 'NOT_CASH' | 'BILLING_EXEMPT' | 'NO_CHARGE' | 'WITHIN_FLOOR' | 'BELOW_MINIMUM';
  requiredAmount: number;
  collectedAmount: number;
  currentBalance: number;
  chargeAmount: number;
  exposure: number;
  projectedBalance: number;
  allowedCreditDeliveries: number;
}

/** Response of GET /collection-policy/cash/impact (§8.1, §12) — a live, read-only rollout preview. */
export interface CashCollectionPolicyImpact {
  wouldOwePayment: number;
  wouldOweOverThreshold: number;
  totalActiveCashCustomers: number;
}

export interface CustomerDeliveryHistoryItem {
  id: string;
  filledDropped: number;
  emptyReceived: number;
  filledReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  bottleBalanceAfter: number | null;
  financialBalanceAfter: number | null;
  deliveredAt: string | null;
  dailySheet: { date: string };
}

export interface LoadTrip {
  id: string;
  tripNumber: number;
  loadedFilled: number;
  returnedFilled: number;
  collectedEmpty: number;
  damagedOnVan: number;
  leakedOnVan: number;
  startedAt: string;
  endedAt: string | null;
  /** Trip Edit-Unlock — mirrors DeliveryItem's own editUnlockedBy/editUnlockExpiresAt/editRequestedAt/editCount/lastEditedAt. */
  editUnlockedBy?: string | null;
  editUnlockExpiresAt?: string | null;
  editRequestedAt?: string | null;
  editCount?: number;
  lastEditedAt?: string | null;
}

export interface SheetExpense {
  id: string;
  category: string;
  amount: number;
  paidFromCash: boolean;
  description: string;
  date: string;
  vanId: string | null;
  van: { id: string; plateNumber: string } | null;
  createdBy: { id: string; name: string };
  /** Trip this expense was recorded during — null if no trip was active at record time. Auto-set server-side. */
  dailySheetLoadId?: string | null;
}

export type CrewRole = 'DRIVER' | 'SALESMAN' | 'LOADER';

export interface SheetCrewMember {
  id: string;
  userId: string;
  role: CrewRole;
  user: { id: string; name: string; role: string };
}

export type CrewCashCategory =
  | 'MEAL'
  | 'TEA'
  | 'WATER'
  | 'SNACKS'
  | 'OPERATIONAL_CASH'
  | 'EMERGENCY_CASH'
  | 'OTHER';

/**
 * Crew Cash Distribution — docs/features/crew-operational-cash-distribution.md.
 * Mirrors the raw `CrewCashDistribution` row as returned by `listForSheet`
 * (no relations included), so `employeeId`/`createdById` are resolved against
 * the sheet's own driver+crew on the frontend rather than joined server-side.
 */
export interface CrewCashEntry {
  id: string;
  dailySheetId: string;
  distributedById: string;
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  notes: string | null;
  photoKeys: string[];
  date: string;
  requiresApproval: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  syncedAt: string | null;
  syncedLedgerEntryId: string | null;
  createdById: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Fleet Operations & Vehicle Intelligence (Phase 1) ──────────────────────────
// docs/features/fleet-operations-vehicle-intelligence.md. Enum unions live in
// ./fleet.ts alongside the checklist/interval config; response shapes live here
// next to the rest of the API response contracts.
import type {
  VehicleFuelType,
  VehicleOwnershipType,
  VehicleOperationalStatus,
  VehicleDocumentType,
  VehicleCheckType,
  VehicleServiceType,
  ChecklistItemResult,
  VehicleMaintenanceUrgency,
} from './fleet';

export interface VehicleProfileEntry {
  id: string;
  vanId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  chassisNumber: string | null;
  engineNumber: string | null;
  fuelType: VehicleFuelType | null;
  transmissionType: string | null;
  loadCapacityKg: number | null;
  seatingCapacity: number | null;
  ownershipType: VehicleOwnershipType | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  supplierName: string | null;
  operationalStatus: VehicleOperationalStatus;
  currentOdometer: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDocumentEntry {
  id: string;
  vanId: string;
  type: VehicleDocumentType;
  documentNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileKey: string | null;
  reminderDaysBefore: number;
  notes: string | null;
  isActive: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDailyCheckEntry {
  id: string;
  vanId: string;
  dailySheetId: string;
  checkType: VehicleCheckType;
  odometerReading: number;
  odometerPhotoKey: string | null;
  fuelGaugeLevel: number | null;
  checklistResults: ChecklistItemResult[];
  hasCriticalFailure: boolean;
  criticalOverrideNote: string | null;
  criticalOverrideById: string | null;
  criticalOverrideAt: string | null;
  odometerContinuityFlag: boolean;
  continuityNote: string | null;
  damageNoted: boolean;
  damageNote: string | null;
  damagePhotoKeys: string[];
  note: string | null;
  recordedBy: { id: string; name: string };
  recordedAt: string;
}

export interface FuelLogEntry {
  id: string;
  vanId: string;
  dailySheetId: string | null;
  date: string;
  odometerAtFill: number;
  litersFilled: number;
  amountPaid: number;
  paidFromCash: boolean;
  isFullTank: boolean;
  fuelStation: string | null;
  receiptPhotoKey: string | null;
  notes: string | null;
  expenseId: string | null;
  recordedBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface VehicleMaintenanceRuleEntry {
  id: string;
  vanId: string;
  serviceType: VehicleServiceType;
  intervalKm: number | null;
  intervalDays: number | null;
  isActive: boolean;
}

export interface VehicleServiceRecordEntry {
  id: string;
  vanId: string;
  serviceType: VehicleServiceType;
  performedAtOdometer: number;
  performedAtDate: string;
  cost: number;
  workshopName: string | null;
  invoicePhotoKey: string | null;
  partsReplaced: string | null;
  notes: string | null;
  expenseId: string | null;
  recordedBy: { id: string; name: string };
  createdAt: string;
}

/** Computed at read-time from the latest VehicleServiceRecord vs. the rule — never cached. */
export interface VehicleMaintenanceStatusEntry {
  ruleId: string;
  vanId: string;
  serviceType: VehicleServiceType;
  label: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdometer: number | null;
  lastServiceDate: string | null;
  dueAtOdometer: number | null;
  dueAtDate: string | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  urgency: VehicleMaintenanceUrgency;
}

export interface VehicleFleetSummaryEntry {
  vanId: string;
  plateNumber: string;
  operationalStatus: VehicleOperationalStatus;
  currentOdometer: number;
  overdueCount: number;
  dueCount: number;
  expiringDocumentCount: number;
  costThisMonth: number;
}

export interface SheetDetail {
  id: string;
  date: string;
  isClosed: boolean;
  vendorId: string;
  filledOutCount: number;
  vanId: string | null;
  driverId: string | null;
  route: { id: string; name: string } | null;
  van: { id: string; plateNumber: string } | null;
  driver: { id: string; name: string } | null;
  crew: SheetCrewMember[];
  crewConfirmed: boolean;
  crewConfirmedAt: string | null;
  crewConfirmedBy: { id: string; name: string } | null;
  // Soft Close (Amendment R9) — null when the sheet was never soft-closed
  // (either still open, or closed the legacy direct way by Staff/Admin).
  closureStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | null;
  closureRequestedAt: string | null;
  closureRequestedBy: { id: string; name: string } | null;
  closureApprovedAt: string | null;
  closureApprovedBy: { id: string; name: string } | null;
  closureRejectedAt: string | null;
  closureRejectedBy: { id: string; name: string } | null;
  closureRejectionReason: string | null;
  items: DeliveryItem[];
  loads: LoadTrip[];
  expenses: SheetExpense[];
  collectionPolicy?: CollectionPolicy;
  cashCollectionPolicy?: CashCollectionPolicy;
  /** Customer Move/Transfer footprint — this sheet as the source of the move. */
  movedOutLogs: DeliveryItemMoveLogEntry[];
  /** Customer Move/Transfer footprint — this sheet as the destination of the move. */
  movedInLogs: DeliveryItemMoveLogEntry[];
  crewCashDistributions: SheetCrewCashDistribution[];
}

/** One Crew Cash Distribution row as returned by GET /daily-sheets/:id (nested
 * employee/distributedBy, unlike the flat-id shape CrewCashEntry gets from the
 * dedicated crew-cash endpoint). Powers the Trip Cards' "Expenses" total —
 * crew cash has no paidFromCash toggle (always physical van cash, see the
 * schema comment on CrewCashDistribution.dailySheetLoadId), so every row is
 * deductible. */
export interface SheetCrewCashDistribution {
  id: string;
  employeeId: string;
  employee: { id: string; name: string };
  distributedById: string;
  distributedBy: { id: string; name: string };
  category: string;
  amount: number;
  notes: string | null;
  date: string;
  requiresApproval: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  syncedAt: string | null;
  /** Trip this crew cash was recorded during — null if no trip was active at record time. Auto-set server-side. */
  dailySheetLoadId?: string | null;
}

/** One row of the Customer Move/Transfer footprint (DeliveryItemMoveLog) —
 * shared shape for both movedOutLogs (fromSheet = this sheet) and
 * movedInLogs (toSheet = this sheet); `otherSheet` always refers to whichever
 * of the pair ISN'T this sheet, so the frontend never has to branch on which
 * list it came from to render "moved between X and Y". */
export interface DeliveryItemMoveLogEntry {
  id: string;
  itemId: string;
  customer: { id: string; name: string; customerCode: string };
  otherSheet: { id: string; date: string; van: { id: string; plateNumber: string } | null };
  movedBy: { id: string; name: string };
  movedAt: string;
  /** Only populated on movedOutLogs — the full item, current state included
   * (it may have progressed past PENDING on the destination sheet since the
   * move). Powers the source sheet's "Moved Out" tab, rendered through the
   * same delivery card as every other tab. Absent on movedInLogs, which only
   * needs the lighter fields above for its row badge. */
  item?: DeliveryItem;
}

/** One entry from GET /daily-sheets/items/:id/history (a generic AuditLog row scoped to one DailySheetItem). */
export interface DeliveryItemHistoryEntry {
  id: string;
  action: 'DELIVERY_SUBMIT' | 'DELIVERY_EDIT_OVERRIDE' | 'DELIVERY_EDIT_UNLOCK' | 'COLLECTION_POLICY_ZERO_CASH' | string;
  userId?: string | null;
  userName?: string | null;
  createdAt: string;
  changes?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  } | null;
}

export interface VanSummary {
  id: string;
  plateNumber: string;
}

export interface DriverSummary {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Payroll — docs/features/staff-payroll-financial-management.md.
// ---------------------------------------------------------------------------

/**
 * Creatable categories only — REVERSAL/CORRECTION/CREW_CASH are system-generated,
 * never chosen through the Log Ledger Entry dialog (mirrors
 * `CREATABLE_LEDGER_CATEGORIES` in the backend's `create-staff-ledger-entry.dto.ts`).
 */
export type CreatableStaffLedgerCategory =
  | 'ADVANCE'
  | 'EXPENSE_REIMBURSEMENT'
  | 'BONUS'
  | 'INCENTIVE'
  | 'OVERTIME'
  | 'PENALTY'
  | 'DEDUCTION'
  | 'LEAVE_UNPAID'
  | 'LEAVE_PAID'
  | 'ADJUSTMENT';

export type StaffLedgerCategory = CreatableStaffLedgerCategory | 'REVERSAL' | 'CORRECTION' | 'CREW_CASH';

export type LedgerEntryStatus = 'PENDING' | 'POSTED' | 'VOIDED';

/** Mirrors the raw `StaffLedgerEntry` row as returned by the ledger endpoints (no relations joined). */
export interface StaffLedgerEntry {
  id: string;
  vendorId: string;
  userId: string;
  category: StaffLedgerCategory;
  /** Signed whole rupees — positive = credit toward employee, negative = debit against employee. */
  amount: number;
  effectiveDate: string;
  description: string | null;
  status: LedgerEntryStatus;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  /** Set once this entry is rolled into a locked payroll period; null while still "open". */
  payrollEntryId: string | null;
  reversedEntryId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type PayFrequency = 'MONTHLY';

/** Mirrors the raw `SalaryStructure` row. */
export interface SalaryStructure {
  id: string;
  vendorId: string;
  userId: string;
  baseAmount: number;
  payFrequency: PayFrequency;
  effectiveFrom: string;
  effectiveTo: string | null;
  recurringLineItems: Array<Record<string, unknown>> | null;
  createdById: string;
  createdAt: string;
}

export type PayrollPeriodStatus = 'OPEN' | 'REVIEW' | 'LOCKED' | 'PAID';

/** Mirrors the raw `PayrollPeriod` row, e.g. from `POST /payroll/periods/open`. */
export interface PayrollPeriod {
  id: string;
  vendorId: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  status: PayrollPeriodStatus;
  lockedAt: string | null;
  lockedById: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PayrollEntryStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'LOCKED' | 'SETTLED';

/** `PayrollEntry` row as returned by `GET /payroll/periods/:periodId/entries` (includes the employee relation). */
export interface PayrollEntry {
  id: string;
  periodId: string;
  userId: string;
  vendorId: string;
  baseSalary: number;
  bonuses: number;
  overtime: number;
  incentives: number;
  advances: number;
  expenses: number;
  penalties: number;
  otherDeductions: number;
  carryForwardIn: number;
  finalPayable: number;
  status: PayrollEntryStatus;
  managerNotes: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; role: string };
}

export type SettlementMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE';

/** Mirrors the raw `Settlement` row as returned by `GET /payroll/entries/:id/settlements`. */
export interface Settlement {
  id: string;
  payrollEntryId: string;
  vendorId: string;
  amount: number;
  method: SettlementMethod;
  referenceNote: string | null;
  paidById: string;
  paidAt: string;
  createdAt: string;
}
