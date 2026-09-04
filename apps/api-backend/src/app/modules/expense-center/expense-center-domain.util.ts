import { CrewCashCategory, ExpenseCategory, StaffLedgerCategory } from '@prisma/client';

/**
 * Expense Center — Phase 1 (read-only orchestration).
 *
 * Pure domain-classification + row-normalization logic for the Expense Center,
 * kept free of Prisma/service dependencies so it is directly unit-testable
 * (same convention as fleet-maintenance.util.ts / fleet-checklist.util.ts).
 *
 * WHY ONLY THREE SOURCES: the vendor dashboard has 5+ expense-recording
 * surfaces, but two of them already spawn a linked row in another table at
 * creation time —
 *   - `FuelLog.expenseId` / `VehicleServiceRecord.expenseId` -> one `Expense`
 *   - `CrewCashDistribution.syncedLedgerEntryId` -> one `StaffLedgerEntry`
 *     (category CREW_CASH), written at sheet close.
 * So reading `Expense` + `StaffLedgerEntry` (EXCLUDING category CREW_CASH) +
 * `CrewCashDistribution` covers every surface exactly once. Reading
 * CrewCashDistribution directly (rather than its synced ledger entries) is
 * what makes pre-sync and post-sync rows appear in one place with one shape,
 * and is precisely why CREW_CASH must be filtered out of the ledger read —
 * otherwise every closed sheet's crew cash would be counted twice.
 */

export type ExpenseCenterDomain =
  | 'VEHICLE'
  | 'EMPLOYEES'
  | 'OFFICE'
  | 'INVENTORY'
  | 'CAPITAL'
  | 'DISCREPANCY';

/**
 * Fixed legend order the frontend renders. CAPITAL has no live source yet
 * (no model feeds it) — it is still emitted in `byDomain` with amount 0 so the
 * legend stays a stable 6-item list instead of reflowing per date range.
 */
export const EXPENSE_CENTER_DOMAINS: readonly ExpenseCenterDomain[] = [
  'VEHICLE',
  'EMPLOYEES',
  'OFFICE',
  'INVENTORY',
  'CAPITAL',
  'DISCREPANCY',
];

/**
 * Phase 2b — refined from the coarser Phase 1 `'EXPENSE' | 'STAFF_LEDGER' |
 * 'CREW_CASH'` for edit-routing: this + `sourceRecordId` tell the frontend
 * WHICH record's own update/delete endpoint to call, not just which of the
 * three read sources a row came from. An `Expense` row auto-spawned by a Fuel
 * Log or a Vehicle Service must route edits to that FuelLog/
 * VehicleServiceRecord (the source record), not to the linked-frozen Expense
 * row itself — see FuelLogService.update / VehicleMaintenanceService.
 * updateServiceRecord for the lockstep write side.
 */
export type ExpenseCenterSourceType = 'EXPENSE' | 'FUEL_LOG' | 'VEHICLE_SERVICE' | 'STAFF_LEDGER' | 'CREW_CASH';

/**
 * DEBIT = money leaving the business the normal way.
 * CREDIT = a payroll-side credit to the EMPLOYEE (their pay goes up) that is
 * still very much a business COST. The frontend must never render a CREDIT row
 * as revenue or subtract it from the total — the flag exists only so the UI can
 * explain "this increased what we owe the employee" vs "this was a deduction".
 */
export type ExpenseCenterCostSign = 'DEBIT' | 'CREDIT';

/** Pseudo-category exposed for CrewCashDistribution rows (it has no matching ExpenseCategory). */
export const CREW_CASH_CATEGORY = 'CREW_CASH' as const;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FUEL_EXPENSE: 'Fuel',
  VEHICLE_MAINTENANCE: 'Vehicle Maintenance',
  ICE_PURCHASED: 'Ice Purchase',
  EXTRA_LOADER: 'Extra Loader',
  DISCREPANCY_WRITE_OFF: 'Discrepancy Write-off',
  OTHER: 'Miscellaneous',
  // Retained-for-history categories (dropped from the add-expense dropdown
  // 2026-08-21 but still present on old rows) — labelled as legacy so a
  // reader can tell them apart from the live ones at a glance.
  LUNCH_EXPENSE_EMPLOYEE: 'Lunch (legacy)',
  ADVANCE_SALARY_EMPLOYEE: 'Salary Advance (legacy)',
};

export const STAFF_LEDGER_CATEGORY_LABELS: Record<StaffLedgerCategory, string> = {
  ADVANCE: 'Salary Advance',
  EXPENSE_REIMBURSEMENT: 'Reimbursement',
  BONUS: 'Bonus',
  INCENTIVE: 'Incentive',
  OVERTIME: 'Overtime',
  PENALTY: 'Penalty',
  DEDUCTION: 'Deduction',
  LEAVE_UNPAID: 'Unpaid Leave',
  LEAVE_PAID: 'Paid Leave',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
  CORRECTION: 'Correction',
  CREW_CASH: 'Crew Cash',
};

export const EXPENSE_CATEGORY_DOMAINS: Record<ExpenseCategory, ExpenseCenterDomain> = {
  FUEL_EXPENSE: 'VEHICLE',
  VEHICLE_MAINTENANCE: 'VEHICLE',
  ICE_PURCHASED: 'INVENTORY',
  EXTRA_LOADER: 'EMPLOYEES',
  LUNCH_EXPENSE_EMPLOYEE: 'EMPLOYEES',
  ADVANCE_SALARY_EMPLOYEE: 'EMPLOYEES',
  DISCREPANCY_WRITE_OFF: 'DISCREPANCY',
  OTHER: 'OFFICE',
};

/**
 * StaffLedgerCategory values that are a credit toward the employee. Still a
 * business cost — see ExpenseCenterCostSign.
 */
const PAYROLL_CREDIT_CATEGORIES: ReadonlySet<StaffLedgerCategory> = new Set<StaffLedgerCategory>([
  StaffLedgerCategory.BONUS,
  StaffLedgerCategory.INCENTIVE,
  StaffLedgerCategory.EXPENSE_REIMBURSEMENT,
  StaffLedgerCategory.LEAVE_PAID,
]);

export function domainForExpenseCategory(category: ExpenseCategory): ExpenseCenterDomain {
  return EXPENSE_CATEGORY_DOMAINS[category] ?? 'OFFICE';
}

/** Every payroll-sourced row (ledger entry or crew cash) is an EMPLOYEES cost. */
export function domainForPayrollRow(): ExpenseCenterDomain {
  return 'EMPLOYEES';
}

export function labelForExpenseCategory(category: ExpenseCategory): string {
  return EXPENSE_CATEGORY_LABELS[category] ?? String(category);
}

export function labelForStaffLedgerCategory(category: StaffLedgerCategory): string {
  return STAFF_LEDGER_CATEGORY_LABELS[category] ?? String(category);
}

export function costSignForStaffLedgerCategory(category: StaffLedgerCategory): ExpenseCenterCostSign {
  return PAYROLL_CREDIT_CATEGORIES.has(category) ? 'CREDIT' : 'DEBIT';
}

/** Matches the existing sheet short-id display convention (daily-sheet-pdf.service.ts). */
export function shortSheetId(dailySheetId: string): string {
  return dailySheetId.slice(0, 8).toUpperCase();
}

/** All category values selectable through the timeline's `category` filter. */
export const EXPENSE_CENTER_CATEGORY_VALUES: readonly string[] = [
  ...Object.values(ExpenseCategory),
  // CREW_CASH is a real StaffLedgerCategory member, so it is already covered
  // here — it just resolves to the CrewCashDistribution source, not the ledger.
  ...Object.values(StaffLedgerCategory),
];

// ──────────────────────────────────────────────────────────────────────────────
// Normalized row
// ──────────────────────────────────────────────────────────────────────────────

export interface ExpenseCenterRow {
  /** `${sourceType}:${originalId}` — stable and unique across the three sources. */
  id: string;
  date: string;
  domain: ExpenseCenterDomain;
  /** Raw ExpenseCategory | StaffLedgerCategory | 'CREW_CASH' value. */
  category: string;
  categoryLabel: string;
  title: string;
  /** Always a positive magnitude, regardless of the source's sign convention. */
  amount: number;
  costSign: ExpenseCenterCostSign;
  /** null for payroll-sourced rows — the cash/card concept does not exist there. */
  paidFromCash: boolean | null;
  recordedByName: string | null;
  sourceType: ExpenseCenterSourceType;
  /** The id of the record whose OWN update/delete endpoint the frontend should call for this row. */
  sourceRecordId: string;
  sourceBadge: string;
  vanPlateNumber: string | null;
  employeeName: string | null;
  /** True when this row cannot be edited/deleted from the Expense Center — see lockedReason for why. */
  locked: boolean;
  lockedReason: string | null;
}

/**
 * Narrow structural input shapes — deliberately NOT the generated Prisma
 * payload types, so these functions can be unit-tested from plain objects
 * while still accepting the real query results (structural assignability).
 */
export interface NormalizableExpenseRow {
  id: string;
  category: ExpenseCategory;
  amount: number;
  paidFromCash: boolean;
  description: string | null;
  date: Date;
  dailySheetId: string | null;
  fuelLog?: { id: string } | null;
  vehicleServiceRecord?: { id: string } | null;
  van?: { plateNumber: string } | null;
  createdBy?: { name: string } | null;
  dailySheet?: { isClosed: boolean } | null;
}

export interface NormalizableStaffLedgerRow {
  id: string;
  category: StaffLedgerCategory;
  /** Signed in the DB (positive = credit toward employee) — normalized to a magnitude here. */
  amount: number;
  description: string | null;
  effectiveDate: Date;
  user?: { name: string } | null;
  createdBy?: { name: string } | null;
  /** Set once this entry is rolled into a frozen payroll period — see fields below. */
  payrollEntryId?: string | null;
}

export interface NormalizableCrewCashRow {
  id: string;
  category: CrewCashCategory;
  amount: number;
  notes: string | null;
  date: Date;
  dailySheetId: string;
  employee?: { name: string } | null;
  distributedBy?: { name: string } | null;
  /** Set once this distribution has been synced into a StaffLedgerEntry. */
  syncedAt?: Date | null;
  dailySheet?: { van?: { plateNumber: string } | null } | null;
}

/** Shared reason text for the two "locked because the sheet/discrepancy is frozen" cases. */
const CLOSED_SHEET_LOCK_REASON = 'Daily Sheet closed — read only';
const DISCREPANCY_LOCK_REASON = 'Resolved discrepancy — immutable';
const PAYROLL_PERIOD_LOCK_REASON = 'Rolled into a locked payroll period — manage this in Payroll.';
const SYNCED_CREW_CASH_LOCK_REASON = 'Synced to the Payroll Ledger — manage this in Payroll.';

/**
 * Lock computation for Expense / FuelLog / VehicleService rows (all three are
 * projections of an `Expense` row plus, for the latter two, a linked source
 * record — see the file header). A resolved discrepancy write-off is
 * immutable regardless of sheet state; otherwise a row is locked exactly when
 * it belongs to a closed daily sheet. `VehicleServiceRecord` never has a
 * `dailySheetId` (confirmed against vehicle-maintenance.service.ts) and a
 * discrepancy write-off is never linked to one either, so VEHICLE_SERVICE
 * rows are unlocked in practice — that falls out of this logic rather than
 * being special-cased.
 */
function lockForExpenseRow(row: NormalizableExpenseRow): { locked: boolean; lockedReason: string | null } {
  if (row.category === ExpenseCategory.DISCREPANCY_WRITE_OFF) {
    return { locked: true, lockedReason: DISCREPANCY_LOCK_REASON };
  }
  if (row.dailySheetId && row.dailySheet?.isClosed) {
    return { locked: true, lockedReason: CLOSED_SHEET_LOCK_REASON };
  }
  return { locked: false, lockedReason: null };
}

export function normalizeExpenseRow(row: NormalizableExpenseRow): ExpenseCenterRow {
  const categoryLabel = labelForExpenseCategory(row.category);
  const description = row.description?.trim();
  const { sourceType, sourceRecordId } = expenseEditRouting(row);
  const { locked, lockedReason } = lockForExpenseRow(row);

  return {
    id: `EXPENSE:${row.id}`,
    date: row.date.toISOString(),
    domain: domainForExpenseCategory(row.category),
    category: row.category,
    categoryLabel,
    title: description ? description : categoryLabel,
    amount: Math.abs(row.amount),
    // Expense rows are unconditionally money leaving the business.
    costSign: 'DEBIT',
    paidFromCash: row.paidFromCash,
    recordedByName: row.createdBy?.name ?? null,
    sourceType,
    sourceRecordId,
    sourceBadge: expenseSourceBadge(row),
    vanPlateNumber: row.van?.plateNumber ?? null,
    // An Expense is not attributed to an employee anywhere in the schema.
    employeeName: null,
    locked,
    lockedReason,
  };
}

/**
 * Which record's own update/delete endpoint an Expense-table row should
 * route edits to. A row with a linked FuelLog/VehicleServiceRecord must edit
 * THAT record (its update endpoint keeps the linked Expense in lockstep —
 * see FuelLogService.update / VehicleMaintenanceService.updateServiceRecord);
 * every other Expense row (manual, Trip Expense, Ice/Extra Loader, discrepancy
 * write-off) edits the Expense row itself.
 */
function expenseEditRouting(row: NormalizableExpenseRow): { sourceType: ExpenseCenterSourceType; sourceRecordId: string } {
  if (row.fuelLog) return { sourceType: 'FUEL_LOG', sourceRecordId: row.fuelLog.id };
  if (row.vehicleServiceRecord) return { sourceType: 'VEHICLE_SERVICE', sourceRecordId: row.vehicleServiceRecord.id };
  return { sourceType: 'EXPENSE', sourceRecordId: row.id };
}

function expenseSourceBadge(row: NormalizableExpenseRow): string {
  if (row.dailySheetId) return `via Daily Sheet #${shortSheetId(row.dailySheetId)}`;
  // A fuel fill / vehicle service auto-spawns its linked Expense — surfacing
  // that provenance is what stops the row looking like a duplicate of the
  // Fleet record the user already sees elsewhere.
  if (row.fuelLog || row.vehicleServiceRecord) return 'via Fleet';
  return 'via Expenses';
}

export function normalizeStaffLedgerRow(row: NormalizableStaffLedgerRow): ExpenseCenterRow {
  const categoryLabel = labelForStaffLedgerCategory(row.category);
  const employeeName = row.user?.name ?? null;
  const description = row.description?.trim();
  const locked = row.payrollEntryId != null;

  return {
    id: `STAFF_LEDGER:${row.id}`,
    date: row.effectiveDate.toISOString(),
    domain: domainForPayrollRow(),
    category: row.category,
    categoryLabel,
    title: description ? description : `${categoryLabel} — ${employeeName ?? 'Employee'}`,
    // StaffLedgerEntry.amount is signed; the Expense Center reports cost
    // magnitudes, and the direction is carried by costSign instead.
    amount: Math.abs(row.amount),
    costSign: costSignForStaffLedgerCategory(row.category),
    paidFromCash: null,
    recordedByName: row.createdBy?.name ?? null,
    sourceType: 'STAFF_LEDGER',
    sourceRecordId: row.id,
    sourceBadge: 'via Payroll',
    // StaffLedgerEntry has no van relation at all.
    vanPlateNumber: null,
    employeeName,
    locked,
    lockedReason: locked ? PAYROLL_PERIOD_LOCK_REASON : null,
  };
}

export function normalizeCrewCashRow(row: NormalizableCrewCashRow): ExpenseCenterRow {
  const notes = row.notes?.trim();
  const locked = row.syncedAt != null;

  return {
    id: `CREW_CASH:${row.id}`,
    date: row.date.toISOString(),
    domain: domainForPayrollRow(),
    category: CREW_CASH_CATEGORY,
    categoryLabel: STAFF_LEDGER_CATEGORY_LABELS.CREW_CASH,
    title: `Crew Cash — ${row.category}${notes ? `: ${notes}` : ''}`,
    // Always stored as a positive magnitude (the debit sign is applied only on
    // the StaffLedgerEntry created at sync) — abs() is belt-and-braces.
    amount: Math.abs(row.amount),
    costSign: 'DEBIT',
    // Crew cash is unconditionally paid from the van's physical cash, but the
    // paidFromCash flag is an Expense-model concept and payroll-sourced rows
    // report null for it uniformly (see the cash/card split note in the service).
    paidFromCash: null,
    // distributedBy = the custodian who recorded/handed out the cash (doc §2),
    // which is the "who entered this" identity the timeline wants.
    recordedByName: row.distributedBy?.name ?? null,
    sourceType: 'CREW_CASH',
    sourceRecordId: row.id,
    // CrewCashDistribution.dailySheetId is non-nullable — always a sheet badge.
    sourceBadge: `via Daily Sheet #${shortSheetId(row.dailySheetId)}`,
    locked,
    lockedReason: locked ? SYNCED_CREW_CASH_LOCK_REASON : null,
    vanPlateNumber: row.dailySheet?.van?.plateNumber ?? null,
    employeeName: row.employee?.name ?? null,
  };
}

/** Newest first; ties broken by composite id so pagination is deterministic. */
export function compareRowsByDateDesc(a: ExpenseCenterRow, b: ExpenseCenterRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

// ──────────────────────────────────────────────────────────────────────────────
// Filter resolution
// ──────────────────────────────────────────────────────────────────────────────

export interface ExpenseCenterSourceSelection {
  /** Expense categories to restrict to, or null for "no restriction". */
  expenseCategories: ExpenseCategory[] | null;
  includeExpenses: boolean;
  /** StaffLedger categories to restrict to (CREW_CASH is always excluded), or null. */
  staffLedgerCategories: StaffLedgerCategory[] | null;
  includeStaffLedger: boolean;
  includeCrewCash: boolean;
}

export interface ExpenseCenterFilterInput {
  domain?: ExpenseCenterDomain;
  category?: string;
  vanId?: string;
  employeeId?: string;
  paymentMethod?: 'CASH' | 'CARD';
}

/**
 * Works out which of the three sources a given filter combination can possibly
 * match, and with which category restriction. Resolving this up front is what
 * lets the service skip whole queries instead of running them and discarding
 * every row.
 */
export function resolveSourceSelection(filter: ExpenseCenterFilterInput): ExpenseCenterSourceSelection {
  const selection: ExpenseCenterSourceSelection = {
    expenseCategories: null,
    includeExpenses: true,
    staffLedgerCategories: null,
    includeStaffLedger: true,
    includeCrewCash: true,
  };

  if (filter.domain) {
    const matching = (Object.keys(EXPENSE_CATEGORY_DOMAINS) as ExpenseCategory[]).filter(
      (category) => EXPENSE_CATEGORY_DOMAINS[category] === filter.domain,
    );
    selection.expenseCategories = matching;
    selection.includeExpenses = matching.length > 0;
    // Every payroll-sourced row is EMPLOYEES by definition.
    const payrollMatches = filter.domain === 'EMPLOYEES';
    selection.includeStaffLedger = payrollMatches;
    selection.includeCrewCash = payrollMatches;
  }

  if (filter.category) {
    const asExpense = (Object.values(ExpenseCategory) as string[]).includes(filter.category)
      ? (filter.category as ExpenseCategory)
      : null;
    const asStaffLedger = (Object.values(StaffLedgerCategory) as string[]).includes(filter.category)
      ? (filter.category as StaffLedgerCategory)
      : null;

    if (asExpense) {
      selection.includeExpenses =
        selection.includeExpenses &&
        (selection.expenseCategories === null || selection.expenseCategories.includes(asExpense));
      selection.expenseCategories = [asExpense];
      selection.includeStaffLedger = false;
      selection.includeCrewCash = false;
    } else if (asStaffLedger === StaffLedgerCategory.CREW_CASH) {
      // CREW_CASH resolves to the CrewCashDistribution source, never the
      // synced ledger copies (which are excluded everywhere, see file header).
      selection.includeExpenses = false;
      selection.includeStaffLedger = false;
    } else if (asStaffLedger) {
      selection.staffLedgerCategories = [asStaffLedger];
      selection.includeExpenses = false;
      selection.includeCrewCash = false;
    } else {
      // Unrecognised category — match nothing rather than silently ignoring it.
      selection.includeExpenses = false;
      selection.includeStaffLedger = false;
      selection.includeCrewCash = false;
    }
  }

  if (filter.paymentMethod === 'CARD') {
    // Payroll-sourced money has no card/cash distinction in the schema and is
    // treated as cash throughout, so a CARD filter excludes it entirely.
    selection.includeStaffLedger = false;
    selection.includeCrewCash = false;
  }

  if (filter.vanId) {
    // StaffLedgerEntry has no van relation; crew cash inherits its van from
    // the parent daily sheet (handled by the service's where clause).
    selection.includeStaffLedger = false;
  }

  if (filter.employeeId) {
    // An Expense is never attributed to an employee.
    selection.includeExpenses = false;
  }

  return selection;
}
