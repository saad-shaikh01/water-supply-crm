import { buildStatement, emptyBucketTotals, summarizeTotals } from './cash-ledger-statement';

describe('buildStatement()', () => {
  const rows = [
    { bucket: 'SHEET_CASH_IN' as const, amount: 10000 },
    { bucket: 'SHEET_CASH_IN' as const, amount: -500 }, // a downward correction
    { bucket: 'OFFICE_CASH_IN' as const, amount: 2000 },
    { bucket: 'OFFICE_EXPENSE' as const, amount: -1500 },
    { bucket: 'PAYROLL_CASH' as const, amount: -3000 },
    { bucket: 'CREW_CASH' as const, amount: -400 },
    { bucket: 'OWNER_TRANSFER' as const, amount: -2500 },
    { bucket: 'FUEL_CARD' as const, amount: -600 },
    { bucket: 'FUEL_CARD' as const, amount: 0 }, // a voided top-up folds as 0
  ];

  it('folds rows by bucket into positive magnitudes and derives the totals', () => {
    expect(buildStatement(rows, 1000)).toEqual({
      broughtForward: 1000,
      sheetCashIn: 9500,
      officeCashIn: 2000,
      totalCashIn: 11500,
      officeExpenses: 1500,
      payrollCash: 3000,
      crewCash: 400,
      totalExpenses: 4900,
      ownerTransfer: 2500,
      fuelCard: 600,
      net: 3500, // 11500 - 4900 - 2500 - 600
      expectedClosing: 4500,
    });
  });

  it('owner transfers and fuel-card top-ups are NOT expenses', () => {
    const s = buildStatement(
      [
        { bucket: 'OWNER_TRANSFER', amount: -9000 },
        { bucket: 'FUEL_CARD', amount: -1000 },
      ],
      0,
    );
    expect(s.totalExpenses).toBe(0);
    expect(s.net).toBe(-10000);
  });

  it('expectedClosing equals broughtForward + the signed sum of all row amounts (the running-balance fold)', () => {
    const s = buildStatement(rows, 250);
    const fold = rows.reduce((acc, r) => acc + r.amount, 250);
    expect(s.expectedClosing).toBe(fold);
  });

  it('an empty period returns brought-forward unchanged', () => {
    const s = buildStatement([], 777.5);
    expect(s.expectedClosing).toBe(777.5);
    expect(s.net).toBe(0);
  });

  it('rounds float noise to 2dp', () => {
    const s = buildStatement(
      [
        { bucket: 'SHEET_CASH_IN', amount: 0.1 },
        { bucket: 'SHEET_CASH_IN', amount: 0.2 },
      ],
      0,
    );
    expect(s.sheetCashIn).toBe(0.3);
    expect(s.expectedClosing).toBe(0.3);
  });
});

describe('summarizeTotals()', () => {
  it('is the shared arithmetic the aggregate path uses (same result as folding rows)', () => {
    const totals = { ...emptyBucketTotals(), sheetCashIn: 800, officeCashIn: 200, payrollCash: 300, ownerTransfer: 100 };
    const viaTotals = summarizeTotals(totals, 50);
    const viaRows = buildStatement(
      [
        { bucket: 'SHEET_CASH_IN', amount: 800 },
        { bucket: 'OFFICE_CASH_IN', amount: 200 },
        { bucket: 'PAYROLL_CASH', amount: -300 },
        { bucket: 'OWNER_TRANSFER', amount: -100 },
      ],
      50,
    );
    expect(viaTotals).toEqual(viaRows);
    expect(viaTotals.expectedClosing).toBe(650);
  });
});
