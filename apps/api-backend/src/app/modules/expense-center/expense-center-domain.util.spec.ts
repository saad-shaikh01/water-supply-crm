import { CrewCashCategory, ExpenseCategory, StaffLedgerCategory } from '@prisma/client';
import {
  compareRowsByDateDesc,
  costSignForStaffLedgerCategory,
  domainForExpenseCategory,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CENTER_DOMAINS,
  normalizeCrewCashRow,
  normalizeExpenseRow,
  normalizeStaffLedgerRow,
  resolveSourceSelection,
  STAFF_LEDGER_CATEGORY_LABELS,
} from './expense-center-domain.util';

const DATE = new Date('2026-09-01T10:00:00.000Z');

describe('domain classification', () => {
  it('maps every ExpenseCategory to a known domain', () => {
    for (const category of Object.values(ExpenseCategory)) {
      expect(EXPENSE_CENTER_DOMAINS).toContain(domainForExpenseCategory(category));
    }
  });

  it('routes fleet categories to VEHICLE, ice to INVENTORY, write-offs to DISCREPANCY', () => {
    expect(domainForExpenseCategory(ExpenseCategory.FUEL_EXPENSE)).toBe('VEHICLE');
    expect(domainForExpenseCategory(ExpenseCategory.VEHICLE_MAINTENANCE)).toBe('VEHICLE');
    expect(domainForExpenseCategory(ExpenseCategory.ICE_PURCHASED)).toBe('INVENTORY');
    expect(domainForExpenseCategory(ExpenseCategory.DISCREPANCY_WRITE_OFF)).toBe('DISCREPANCY');
    expect(domainForExpenseCategory(ExpenseCategory.OTHER)).toBe('OFFICE');
    expect(domainForExpenseCategory(ExpenseCategory.EXTRA_LOADER)).toBe('EMPLOYEES');
  });

  it('has a label for every category in both enums', () => {
    for (const category of Object.values(ExpenseCategory)) {
      expect(EXPENSE_CATEGORY_LABELS[category]).toBeTruthy();
    }
    for (const category of Object.values(StaffLedgerCategory)) {
      expect(STAFF_LEDGER_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe('costSignForStaffLedgerCategory', () => {
  it('marks employee-credit categories CREDIT and everything else DEBIT', () => {
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.BONUS)).toBe('CREDIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.INCENTIVE)).toBe('CREDIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.EXPENSE_REIMBURSEMENT)).toBe('CREDIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.LEAVE_PAID)).toBe('CREDIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.ADVANCE)).toBe('DEBIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.PENALTY)).toBe('DEBIT');
    expect(costSignForStaffLedgerCategory(StaffLedgerCategory.CREW_CASH)).toBe('DEBIT');
  });
});

describe('normalizeExpenseRow', () => {
  const base = {
    id: 'e1',
    category: ExpenseCategory.ICE_PURCHASED,
    amount: 1200,
    paidFromCash: true,
    description: 'Two ice slabs',
    date: DATE,
    dailySheetId: null,
    fuelLog: null,
    vehicleServiceRecord: null,
    van: { plateNumber: 'ABC-123' },
    createdBy: { name: 'Ali' },
  };

  it('produces a composite id and keeps the description as the title', () => {
    const row = normalizeExpenseRow(base);
    expect(row.id).toBe('EXPENSE:e1');
    expect(row.title).toBe('Two ice slabs');
    expect(row.sourceType).toBe('EXPENSE');
    expect(row.costSign).toBe('DEBIT');
    expect(row.paidFromCash).toBe(true);
    expect(row.vanPlateNumber).toBe('ABC-123');
    expect(row.recordedByName).toBe('Ali');
    expect(row.employeeName).toBeNull();
  });

  it('falls back to the category label when the description is blank', () => {
    expect(normalizeExpenseRow({ ...base, description: '   ' }).title).toBe('Ice Purchase');
    expect(normalizeExpenseRow({ ...base, description: null }).title).toBe('Ice Purchase');
  });

  it('badges by provenance: daily sheet wins over fleet, fleet over plain expenses', () => {
    expect(normalizeExpenseRow({ ...base, dailySheetId: 'abcdef1234' }).sourceBadge).toBe(
      'via Daily Sheet #ABCDEF12',
    );
    expect(normalizeExpenseRow({ ...base, fuelLog: { id: 'f1' } }).sourceBadge).toBe('via Fleet');
    expect(
      normalizeExpenseRow({ ...base, vehicleServiceRecord: { id: 'v1' } }).sourceBadge,
    ).toBe('via Fleet');
    expect(normalizeExpenseRow(base).sourceBadge).toBe('via Expenses');
  });

  it('routes a plain manual expense to EXPENSE, itself as the source record', () => {
    const row = normalizeExpenseRow(base);
    expect(row.sourceType).toBe('EXPENSE');
    expect(row.sourceRecordId).toBe('e1');
  });

  it('routes a fuel-linked expense to FUEL_LOG, the fuel log as the source record', () => {
    const row = normalizeExpenseRow({ ...base, fuelLog: { id: 'fuel-1' } });
    expect(row.sourceType).toBe('FUEL_LOG');
    expect(row.sourceRecordId).toBe('fuel-1');
  });

  it('routes a maintenance-linked expense to VEHICLE_SERVICE, the service record as the source record', () => {
    const row = normalizeExpenseRow({ ...base, vehicleServiceRecord: { id: 'svc-1' } });
    expect(row.sourceType).toBe('VEHICLE_SERVICE');
    expect(row.sourceRecordId).toBe('svc-1');
  });

  it('is unlocked when it belongs to no sheet, or an open one', () => {
    expect(normalizeExpenseRow(base).locked).toBe(false);
    expect(normalizeExpenseRow(base).lockedReason).toBeNull();

    const openSheetRow = normalizeExpenseRow({
      ...base,
      dailySheetId: 'sheet-1',
      dailySheet: { isClosed: false },
    });
    expect(openSheetRow.locked).toBe(false);
    expect(openSheetRow.lockedReason).toBeNull();
  });

  it('locks a row belonging to a closed daily sheet with the sheet reason', () => {
    const row = normalizeExpenseRow({
      ...base,
      dailySheetId: 'sheet-1',
      dailySheet: { isClosed: true },
    });
    expect(row.locked).toBe(true);
    expect(row.lockedReason).toBe('Daily Sheet closed — read only');
  });

  it('locks a discrepancy write-off unconditionally, even on an open (or no) sheet', () => {
    const row = normalizeExpenseRow({
      ...base,
      category: ExpenseCategory.DISCREPANCY_WRITE_OFF,
      dailySheetId: 'sheet-1',
      dailySheet: { isClosed: false },
    });
    expect(row.locked).toBe(true);
    expect(row.lockedReason).toBe('Resolved discrepancy — immutable');
  });
});

describe('normalizeStaffLedgerRow', () => {
  const base = {
    id: 's1',
    category: StaffLedgerCategory.ADVANCE,
    amount: -5000,
    description: null,
    effectiveDate: DATE,
    user: { name: 'Bilal' },
    createdBy: { name: 'Manager' },
  };

  it('reports a positive magnitude regardless of the ledger sign', () => {
    expect(normalizeStaffLedgerRow(base).amount).toBe(5000);
    expect(normalizeStaffLedgerRow({ ...base, amount: 5000 }).amount).toBe(5000);
  });

  it('auto-describes as "<label> — <employee>" when there is no description', () => {
    expect(normalizeStaffLedgerRow(base).title).toBe('Salary Advance — Bilal');
    expect(normalizeStaffLedgerRow({ ...base, description: 'Eid advance' }).title).toBe('Eid advance');
  });

  it('reports null paidFromCash and a payroll badge', () => {
    const row = normalizeStaffLedgerRow(base);
    expect(row.paidFromCash).toBeNull();
    expect(row.sourceBadge).toBe('via Payroll');
    expect(row.domain).toBe('EMPLOYEES');
    expect(row.vanPlateNumber).toBeNull();
    expect(row.employeeName).toBe('Bilal');
  });

  it('routes to STAFF_LEDGER with itself as the source record', () => {
    const row = normalizeStaffLedgerRow(base);
    expect(row.sourceType).toBe('STAFF_LEDGER');
    expect(row.sourceRecordId).toBe('s1');
  });

  it('is unlocked when not rolled into a payroll period', () => {
    const row = normalizeStaffLedgerRow(base);
    expect(row.locked).toBe(false);
    expect(row.lockedReason).toBeNull();
  });

  it('locks once rolled into a payroll period', () => {
    const row = normalizeStaffLedgerRow({ ...base, payrollEntryId: 'payroll-1' });
    expect(row.locked).toBe(true);
    expect(row.lockedReason).toBe('Rolled into a locked payroll period — manage this in Payroll.');
  });
});

describe('normalizeCrewCashRow', () => {
  const base = {
    id: 'c1',
    category: CrewCashCategory.MEAL,
    amount: 300,
    notes: null,
    date: DATE,
    dailySheetId: 'sheet1234abcd',
    employee: { name: 'Usman' },
    distributedBy: { name: 'Salesman' },
    dailySheet: { van: { plateNumber: 'XYZ-9' } },
  };

  it('always reports category CREW_CASH and folds the crew-cash kind into the title', () => {
    const row = normalizeCrewCashRow(base);
    expect(row.category).toBe('CREW_CASH');
    expect(row.categoryLabel).toBe('Crew Cash');
    expect(row.title).toBe('Crew Cash — MEAL');
    expect(row.sourceBadge).toBe('via Daily Sheet #SHEET123');
    expect(row.vanPlateNumber).toBe('XYZ-9');
    expect(row.employeeName).toBe('Usman');
    expect(row.recordedByName).toBe('Salesman');
  });

  it('appends notes when present', () => {
    expect(normalizeCrewCashRow({ ...base, notes: 'lunch for 3' }).title).toBe(
      'Crew Cash — MEAL: lunch for 3',
    );
  });

  it('routes to CREW_CASH with itself as the source record', () => {
    const row = normalizeCrewCashRow(base);
    expect(row.sourceType).toBe('CREW_CASH');
    expect(row.sourceRecordId).toBe('c1');
  });

  it('is unlocked while unsynced', () => {
    const row = normalizeCrewCashRow(base);
    expect(row.locked).toBe(false);
    expect(row.lockedReason).toBeNull();
  });

  it('locks once synced to the payroll ledger', () => {
    const row = normalizeCrewCashRow({ ...base, syncedAt: DATE });
    expect(row.locked).toBe(true);
    expect(row.lockedReason).toBe('Synced to the Payroll Ledger — manage this in Payroll.');
  });
});

describe('compareRowsByDateDesc', () => {
  it('sorts newest first', () => {
    const older = normalizeExpenseRow({
      id: 'a',
      category: ExpenseCategory.OTHER,
      amount: 1,
      paidFromCash: true,
      description: 'a',
      date: new Date('2026-01-01T00:00:00.000Z'),
      dailySheetId: null,
    });
    const newer = normalizeExpenseRow({
      id: 'b',
      category: ExpenseCategory.OTHER,
      amount: 1,
      paidFromCash: true,
      description: 'b',
      date: new Date('2026-02-01T00:00:00.000Z'),
      dailySheetId: null,
    });
    expect([older, newer].sort(compareRowsByDateDesc)).toEqual([newer, older]);
  });
});

describe('resolveSourceSelection', () => {
  it('includes all three sources when unfiltered', () => {
    const selection = resolveSourceSelection({});
    expect(selection.includeExpenses).toBe(true);
    expect(selection.includeStaffLedger).toBe(true);
    expect(selection.includeCrewCash).toBe(true);
    expect(selection.expenseCategories).toBeNull();
  });

  it('drops payroll sources for a non-EMPLOYEES domain', () => {
    const selection = resolveSourceSelection({ domain: 'VEHICLE' });
    expect(selection.expenseCategories).toEqual(
      expect.arrayContaining([ExpenseCategory.FUEL_EXPENSE, ExpenseCategory.VEHICLE_MAINTENANCE]),
    );
    expect(selection.includeStaffLedger).toBe(false);
    expect(selection.includeCrewCash).toBe(false);
  });

  it('keeps every source for the EMPLOYEES domain', () => {
    const selection = resolveSourceSelection({ domain: 'EMPLOYEES' });
    expect(selection.includeExpenses).toBe(true);
    expect(selection.includeStaffLedger).toBe(true);
    expect(selection.includeCrewCash).toBe(true);
  });

  it('matches nothing for CAPITAL, which has no live source', () => {
    const selection = resolveSourceSelection({ domain: 'CAPITAL' });
    expect(selection.includeExpenses).toBe(false);
    expect(selection.includeStaffLedger).toBe(false);
    expect(selection.includeCrewCash).toBe(false);
  });

  it('routes a CREW_CASH category filter to the distribution table only', () => {
    const selection = resolveSourceSelection({ category: StaffLedgerCategory.CREW_CASH });
    expect(selection.includeExpenses).toBe(false);
    expect(selection.includeStaffLedger).toBe(false);
    expect(selection.includeCrewCash).toBe(true);
  });

  it('routes an ExpenseCategory filter to Expense only, and a ledger category to the ledger only', () => {
    const expenseFilter = resolveSourceSelection({ category: ExpenseCategory.FUEL_EXPENSE });
    expect(expenseFilter.expenseCategories).toEqual([ExpenseCategory.FUEL_EXPENSE]);
    expect(expenseFilter.includeStaffLedger).toBe(false);
    expect(expenseFilter.includeCrewCash).toBe(false);

    const ledgerFilter = resolveSourceSelection({ category: StaffLedgerCategory.BONUS });
    expect(ledgerFilter.staffLedgerCategories).toEqual([StaffLedgerCategory.BONUS]);
    expect(ledgerFilter.includeExpenses).toBe(false);
    expect(ledgerFilter.includeCrewCash).toBe(false);
  });

  it('contradictory domain + category matches nothing', () => {
    const selection = resolveSourceSelection({
      domain: 'VEHICLE',
      category: ExpenseCategory.ICE_PURCHASED,
    });
    expect(selection.includeExpenses).toBe(false);
  });

  it('CARD excludes payroll sources; CASH keeps everything', () => {
    const card = resolveSourceSelection({ paymentMethod: 'CARD' });
    expect(card.includeStaffLedger).toBe(false);
    expect(card.includeCrewCash).toBe(false);

    const cash = resolveSourceSelection({ paymentMethod: 'CASH' });
    expect(cash.includeStaffLedger).toBe(true);
    expect(cash.includeCrewCash).toBe(true);
  });

  it('vanId excludes the ledger (no van relation); employeeId excludes Expense (no employee)', () => {
    expect(resolveSourceSelection({ vanId: 'v1' }).includeStaffLedger).toBe(false);
    expect(resolveSourceSelection({ vanId: 'v1' }).includeCrewCash).toBe(true);
    expect(resolveSourceSelection({ employeeId: 'u1' }).includeExpenses).toBe(false);
  });
});
