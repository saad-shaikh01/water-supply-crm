import { buildReconciliation, isSheetModifiedAfterClose, resolveSheetCash, SHEET_CASH_RELOAD_INCLUDE } from './sheet-cash.util';

/**
 * Unit tests: isSheetModifiedAfterClose — the "this closed sheet's frozen cash
 * columns are stale, switch it to a live recompute" predicate shared by the
 * findOne divergence banner and the dashboard / analytics / driver-stats hybrid
 * cash rollups.
 */
describe('isSheetModifiedAfterClose', () => {
  it('false for an untouched closed sheet', () => {
    expect(isSheetModifiedAfterClose({ items: [], loads: [] })).toBe(false);
  });

  it('true for a voided item', () => {
    expect(isSheetModifiedAfterClose({ items: [{ voidedAt: new Date() }], loads: [] })).toBe(true);
  });

  it('true for a delivery correction', () => {
    expect(
      isSheetModifiedAfterClose({
        items: [{ isCorrection: true, correctionAddedAt: new Date() }],
        loads: [],
      }),
    ).toBe(true);
  });

  it('true for a trip check-in correction', () => {
    expect(isSheetModifiedAfterClose({ items: [], loads: [{ editCount: 1 }] })).toBe(true);
  });

  // Post-Close Expense Correction
  it('true for { postCloseExpenseCorrectionCount: 1 } alone', () => {
    expect(isSheetModifiedAfterClose({ postCloseExpenseCorrectionCount: 1 })).toBe(true);
  });

  it('false for { postCloseExpenseCorrectionCount: 0 } alone', () => {
    expect(
      isSheetModifiedAfterClose({ items: [], loads: [], postCloseExpenseCorrectionCount: 0 }),
    ).toBe(false);
  });

  // Post-Close Crew Cash Correction
  it('true for { postCloseCrewCashCorrectionCount: 1 } alone', () => {
    expect(isSheetModifiedAfterClose({ postCloseCrewCashCorrectionCount: 1 })).toBe(true);
  });

  it('false when both post-close correction counters are 0', () => {
    expect(
      isSheetModifiedAfterClose({
        items: [],
        loads: [],
        postCloseExpenseCorrectionCount: 0,
        postCloseCrewCashCorrectionCount: 0,
      }),
    ).toBe(false);
  });
});

/**
 * Daily Sheet Advances (owner-requested 2026-10-01) — salary advances paid out of the
 * van's cash reduce the driver's hand-in exactly like Expense / Crew Cash rows.
 */
describe('buildReconciliation — Daily Sheet advances', () => {
  const sheetWith = (over: Record<string, unknown> = {}) => ({
    id: 'sheet-1',
    isClosed: true,
    filledOutCount: 0,
    filledInCount: 0,
    emptyInCount: 0,
    cashCollected: 1000,
    cashExpected: 1000,
    items: [
      {
        status: 'COMPLETED',
        filledDropped: 0,
        filledReceived: 0,
        emptyReceived: 0,
        cashCollected: 1000,
        pricePerBottle: 0,
        productId: 'p1',
        customer: { paymentType: 'CASH', customPrices: [] },
        product: { basePrice: 0 },
      },
    ],
    expenses: [],
    crewCashDistributions: [],
    sheetAdvances: [],
    loads: [],
    ...over,
  });

  it('subtracts advances from the net hand-in and reports them', () => {
    const r = buildReconciliation(sheetWith({ sheetAdvances: [{ amount: 300 }] }));
    expect(r.advances.total).toBe(300);
    expect(r.driver.advancesPaidFromCash).toBe(300);
    expect(r.driver.shouldHandIn).toBe(1000);
    expect(r.driver.netToHandIn).toBe(700);
    expect(r.driver.totalToHandIn).toBe(700);
  });

  it('deducts expenses, crew cash and advances together', () => {
    const r = buildReconciliation(
      sheetWith({
        expenses: [{ amount: 100, paidFromCash: true }],
        crewCashDistributions: [{ amount: 50 }],
        sheetAdvances: [{ amount: 200 }, { amount: 100 }],
      }),
    );
    expect(r.driver.netToHandIn).toBe(550);
  });

  it('never lets a VOIDED advance deduct cash', () => {
    const r = buildReconciliation(sheetWith({ sheetAdvances: [{ amount: 300, status: 'VOIDED' }, { amount: 100, status: 'ACTIVE' }] }));
    expect(r.advances.total).toBe(100);
    expect(r.driver.netToHandIn).toBe(900);
  });

  it('counts advances in the unexplained-discrepancy math, so a correctly-deducted advance is not a shortfall', () => {
    // driver handed in 700 of 1000 recorded; the 300 gap IS the advance.
    const r = buildReconciliation(sheetWith({ cashCollected: 700, sheetAdvances: [{ amount: 300 }] }));
    expect(r.driver.discrepancy).toBe(300);
    expect(r.driver.unexplainedDiscrepancy).toBe(0);
  });

  it('floors the net hand-in at 0 when deductions exceed the cash recorded', () => {
    const r = buildReconciliation(sheetWith({ sheetAdvances: [{ amount: 5000 }] }));
    expect(r.driver.netToHandIn).toBe(0);
  });

  it('is byte-identical to before for a sheet with no advances (or a loader that never fetched them)', () => {
    const withEmpty = buildReconciliation(sheetWith());
    const withoutKey = buildReconciliation(sheetWith({ sheetAdvances: undefined }));
    expect(withEmpty.driver.netToHandIn).toBe(1000);
    expect(withoutKey.driver.netToHandIn).toBe(1000);
    expect(withoutKey.advances.total).toBe(0);
  });
});

describe('resolveSheetCash — Daily Sheet advances on a closed sheet', () => {
  it('a post-close advance switches the sheet to a live recompute that deducts it', () => {
    const resolved = resolveSheetCash({
      id: 'sheet-1',
      isClosed: true,
      cashCollected: 1000, // frozen close-time figures
      cashExpected: 1000,
      postCloseCrewCashCorrectionCount: 1, // the shared marker SheetAdvanceService bumps
      filledOutCount: 0,
      filledInCount: 0,
      emptyInCount: 0,
      items: [
        {
          status: 'COMPLETED', filledDropped: 0, filledReceived: 0, emptyReceived: 0, cashCollected: 1000,
          pricePerBottle: 0, productId: 'p1', customer: { paymentType: 'CASH', customPrices: [] }, product: { basePrice: 0 },
        },
      ],
      expenses: [],
      crewCashDistributions: [],
      sheetAdvances: [{ amount: 400 }],
      loads: [],
    });
    expect(resolved.postCloseModified).toBe(true);
    expect(resolved.cashExpected).toBe(600);
  });

  it('the targeted reload fetches ONLY active advances', () => {
    expect(SHEET_CASH_RELOAD_INCLUDE.sheetAdvances).toEqual({ where: { status: 'ACTIVE' }, select: { amount: true } });
  });
});
