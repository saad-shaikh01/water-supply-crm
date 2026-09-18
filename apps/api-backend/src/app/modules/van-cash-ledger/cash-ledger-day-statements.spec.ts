import { buildDayStatements, computeLagDays } from './cash-ledger-day-statements';

describe('computeLagDays', () => {
  const date = '2026-09-10T00:00:00.000Z'; // date-only, stored at UTC midnight = 05:00 PKT on the 10th

  it('is 0 for any moment of the same PKT day (23:30 PKT included)', () => {
    expect(computeLagDays('2026-09-09T19:00:00.000Z', date)).toBe(0); // 00:00 PKT on the 10th
    expect(computeLagDays('2026-09-10T18:59:59.000Z', date)).toBe(0); // 23:59:59 PKT on the 10th
  });

  it('flips at PKT midnight, not UTC midnight', () => {
    expect(computeLagDays('2026-09-10T19:00:00.000Z', date)).toBe(1); // 00:00 PKT on the 11th
    expect(computeLagDays('2026-09-12T20:30:00.000Z', date)).toBe(3); // 01:30 PKT on the 13th
  });

  it('is negative for a future-dated business day', () => {
    expect(computeLagDays('2026-09-09T06:00:00.000Z', date)).toBe(-1);
    expect(computeLagDays('2026-09-01T06:00:00.000Z', date)).toBe(-9);
  });

  it('counts whole days across a month boundary', () => {
    expect(computeLagDays('2026-10-02T06:00:00.000Z', '2026-09-30T00:00:00.000Z')).toBe(2);
  });
});

describe('buildDayStatements', () => {
  const row = (date: string, bucket: any, amount: number, lagDays = 0) => ({ date, bucket, amount, lagDays });

  it('returns an empty list for no rows', () => {
    expect(buildDayStatements([], 500)).toEqual([]);
  });

  it('chains opening -> closing across days starting from broughtForward, using buildStatement semantics', () => {
    const days = buildDayStatements(
      [
        row('2026-09-10T06:00:00Z', 'SHEET_CASH_IN', 1000),
        row('2026-09-10T07:00:00Z', 'OFFICE_EXPENSE', -300, 2),
        row('2026-09-10T08:00:00Z', 'PAYROLL_CASH', -100),
        row('2026-09-12T06:00:00Z', 'OWNER_TRANSFER', -200),
        row('2026-09-12T07:00:00Z', 'FUEL_CARD', -50, 1),
      ],
      500,
    );

    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      date: '2026-09-10',
      opening: 500,
      sheetCashIn: 1000,
      officeCashIn: 0,
      totalCashIn: 1000,
      officeExpenses: 300,
      payrollCash: 100,
      crewCash: 0,
      totalExpenses: 400,
      ownerTransfer: 0,
      fuelCard: 0,
      net: 600,
      closing: 1100,
      entryCount: 3,
      lateCount: 1,
    });
    // transfers are kept apart from expenses
    expect(days[1]).toMatchObject({
      date: '2026-09-12',
      opening: 1100,
      totalExpenses: 0,
      ownerTransfer: 200,
      fuelCard: 50,
      net: -250,
      closing: 850,
      entryCount: 2,
      lateCount: 1,
    });
  });

  it('buckets by PKT day: 23:30 PKT and 00:30 PKT the next day land on different days', () => {
    const days = buildDayStatements(
      [row('2026-09-10T18:30:00Z', 'OFFICE_CASH_IN', 10), row('2026-09-10T19:30:00Z', 'OFFICE_CASH_IN', 20)],
      0,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-09-10', '2026-09-11']);
    expect(days.map((d) => d.closing)).toEqual([10, 30]);
  });

  it('a voided (0-amount) row counts as an entry but moves nothing', () => {
    const [day] = buildDayStatements([row('2026-09-10T06:00:00Z', 'CREW_CASH', 0)], 100);
    expect(day).toMatchObject({ entryCount: 1, crewCash: 0, net: 0, opening: 100, closing: 100 });
  });
});
