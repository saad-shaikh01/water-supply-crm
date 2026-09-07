import { isSheetModifiedAfterClose } from './sheet-cash.util';

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
});
