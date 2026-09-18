import type { CashLedgerBucket } from './cash-ledger-buckets';
import { buildDailySummary, DAILY_SUMMARY_ROW_CAP, labelDay, labelMonth, labelRange, type DailySummaryRow } from './cash-ledger-daily-summary';
import { computeLagDays } from './cash-ledger-day-statements';
import { buildStatement } from './cash-ledger-statement';

/**
 * PKT = UTC+5 year-round. 06:00Z = 11:00 PKT (safely mid-day); 18:30Z = 23:30 PKT
 * the SAME day; 19:30Z = 00:30 PKT the NEXT day.
 */
const noon = (day: string) => `${day}T06:00:00.000Z`;

function row(
  date: string,
  bucket: CashLedgerBucket,
  amount: number,
  over: Partial<DailySummaryRow> & { createdAt?: string } = {},
): DailySummaryRow {
  const createdAt = over.createdAt ?? date;
  return {
    date,
    createdAt,
    bucket,
    amount,
    lagDays: computeLagDays(createdAt, date),
    isEdited: false,
    isVoided: false,
    ...over,
  };
}

const cashIn = (day: string, amount: number, over = {}) => row(noon(day), 'SHEET_CASH_IN', amount, over);
const expenseRow = (day: string, amount: number, over = {}) => row(noon(day), 'OFFICE_EXPENSE', -amount, over);

const base = { group: 'day' as const, includeEmpty: false, pendingDays: [] as string[] };

describe('buildDailySummary (Cash Ledger P3 table view)', () => {
  describe('labels', () => {
    it('day / month / range labels', () => {
      expect(labelDay('2026-07-08')).toBe('Wed, 8 Jul 2026');
      expect(labelMonth('2026-07-15')).toBe('Jul 2026');
      expect(labelRange('2026-07-06', '2026-07-12')).toBe('6 – 12 Jul 2026');
      expect(labelRange('2026-09-30', '2026-10-01')).toBe('30 Sep – 1 Oct 2026');
      expect(labelRange('2026-12-29', '2027-01-04')).toBe('29 Dec 2026 – 4 Jan 2027');
      expect(labelRange('2026-07-08', '2026-07-08')).toBe('8 Jul 2026');
    });
  });

  describe('day grouping', () => {
    const rows = [cashIn('2026-09-10', 1000), expenseRow('2026-09-10', 300), cashIn('2026-09-12', 500)];

    it('newest first; days with activity only; opening/closing chain from broughtForward', () => {
      const { rows: out } = buildDailySummary({ ...base, rows, broughtForward: 200, from: '2026-09-01', to: '2026-09-30' });

      expect(out.map((r) => r.key)).toEqual(['2026-09-12', '2026-09-10']);
      expect(out[1]).toMatchObject({
        key: '2026-09-10',
        label: 'Thu, 10 Sep 2026',
        from: '2026-09-10',
        to: '2026-09-10',
        opening: 200,
        sheetCashIn: 1000,
        officeExpenses: 300,
        totalExpenses: 300,
        totalCashIn: 1000,
        net: 700,
        closing: 900,
        entryCount: 2,
        isEmpty: false,
      });
      expect(out[0]).toMatchObject({ opening: 900, closing: 1400, net: 500, entryCount: 1 });
      expect(out[0].opening).toBe(out[1].closing);
    });

    it('includeEmpty fills every PKT day in [from, to]; balance carries; isEmpty flagged', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows,
        broughtForward: 200,
        from: '2026-09-09',
        to: '2026-09-13',
      });

      expect(out.map((r) => r.key)).toEqual(['2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10', '2026-09-09']);
      expect(out.map((r) => r.isEmpty)).toEqual([true, false, true, false, true]);
      const empty = out.filter((r) => r.isEmpty);
      for (const r of empty) {
        expect(r.opening).toBe(r.closing);
        expect(r.net).toBe(0);
        expect(r.entryCount).toBe(0);
        expect(r.totalCashIn).toBe(0);
      }
      // 09 opens at brought-forward, 13 carries the final closing.
      expect(out[4]).toMatchObject({ opening: 200, closing: 200 });
      expect(out[0]).toMatchObject({ opening: 1400, closing: 1400 });
      // chain across empty days
      for (let i = 0; i < out.length - 1; i++) expect(out[i].opening).toBe(out[i + 1].closing);
    });

    it('nothing at all, no includeEmpty -> no rows; with includeEmpty the range is still filled', () => {
      expect(buildDailySummary({ ...base, rows: [], broughtForward: 50, from: '2026-09-01', to: '2026-09-03' }).rows).toEqual([]);
      const { rows: out, totals } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows: [],
        broughtForward: 50,
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(out).toHaveLength(3);
      expect(out.every((r) => r.isEmpty && r.opening === 50 && r.closing === 50)).toBe(true);
      expect(totals).toMatchObject({ broughtForward: 50, expectedClosing: 50, entryCount: 0 });
    });
  });

  describe('PKT day boundary', () => {
    it('23:30 PKT and 00:30 PKT (next day) land in different days', () => {
      const rows = [
        row('2026-09-10T18:30:00.000Z', 'SHEET_CASH_IN', 100), // 23:30 PKT on the 10th
        row('2026-09-10T19:30:00.000Z', 'SHEET_CASH_IN', 40), // 00:30 PKT on the 11th
      ];
      const { rows: out } = buildDailySummary({ ...base, rows, broughtForward: 0, from: '2026-09-10', to: '2026-09-11' });
      expect(out.map((r) => [r.key, r.sheetCashIn])).toEqual([
        ['2026-09-11', 40],
        ['2026-09-10', 100],
      ]);
    });

    it('recordedCount buckets by the PKT day of createdAt (23:30 vs 00:30 PKT)', () => {
      const rows = [
        row(noon('2026-09-10'), 'SHEET_CASH_IN', 1, { createdAt: '2026-09-10T18:30:00.000Z' }), // recorded 10th PKT
        row(noon('2026-09-10'), 'SHEET_CASH_IN', 1, { createdAt: '2026-09-10T19:30:00.000Z' }), // recorded 11th PKT
      ];
      const { rows: out } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows,
        broughtForward: 0,
        from: '2026-09-10',
        to: '2026-09-11',
      });
      expect(out.find((r) => r.key === '2026-09-10')).toMatchObject({ entryCount: 2, recordedCount: 1, lateCount: 1 });
      expect(out.find((r) => r.key === '2026-09-11')).toMatchObject({ entryCount: 0, recordedCount: 1, isEmpty: true });
    });
  });

  describe('week grouping (Monday-start, PKT)', () => {
    // 2026-07-06 is a Monday.
    const rows = [
      cashIn('2026-07-05', 100), // Sunday -> week of 29 Jun
      cashIn('2026-07-06', 200), // Monday -> week of 6 Jul
      expenseRow('2026-07-08', 50),
      cashIn('2026-07-12', 10), // Sunday -> still week of 6 Jul
      cashIn('2026-07-13', 1000), // Monday -> week of 13 Jul
    ];

    it('splits on the Monday boundary; aggregates the day statements; clamps first/last labels to the range', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'week',
        rows,
        broughtForward: 0,
        from: '2026-07-05',
        to: '2026-07-13',
      });

      expect(out.map((r) => r.key)).toEqual(['2026-07-13', '2026-07-06', '2026-06-29']);
      expect(out.map((r) => r.label)).toEqual(['13 Jul 2026', '6 – 12 Jul 2026', '5 Jul 2026']);
      expect(out.map((r) => [r.from, r.to])).toEqual([
        ['2026-07-13', '2026-07-13'],
        ['2026-07-06', '2026-07-12'],
        ['2026-07-05', '2026-07-05'],
      ]);
      // middle week: opening = first day's opening, closing = last day's closing, sums added
      expect(out[1]).toMatchObject({
        opening: 100,
        sheetCashIn: 210,
        officeExpenses: 50,
        totalExpenses: 50,
        net: 160,
        closing: 260,
        entryCount: 3,
      });
      expect(out[0]).toMatchObject({ opening: 260, closing: 1260 });
      expect(out[2]).toMatchObject({ opening: 0, closing: 100 });
    });

    it('a full week inside the range is not clamped', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'week',
        rows: [cashIn('2026-07-08', 5)],
        broughtForward: 0,
        from: '2026-06-01',
        to: '2026-08-31',
      });
      expect(out[0]).toMatchObject({ key: '2026-07-06', from: '2026-07-06', to: '2026-07-12', label: '6 – 12 Jul 2026' });
    });

    it('a week spanning 30 Sep - 1 Oct clamps at BOTH ends of the range and is one row', () => {
      // 2026-09-28 is a Monday; that week runs 28 Sep - 4 Oct.
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'week',
        rows: [cashIn('2026-09-30', 100), cashIn('2026-10-01', 40)],
        broughtForward: 0,
        from: '2026-09-30',
        to: '2026-10-01',
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        key: '2026-09-28',
        from: '2026-09-30',
        to: '2026-10-01',
        label: '30 Sep – 1 Oct 2026',
        sheetCashIn: 140,
        entryCount: 2,
      });
    });

    it('week recordedCount counts by the week of createdAt; includeEmpty week fill', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'week',
        includeEmpty: true,
        rows: [cashIn('2026-07-06', 100, { createdAt: noon('2026-07-14') })],
        broughtForward: 0,
        from: '2026-07-06',
        to: '2026-07-19',
      });
      expect(out.map((r) => r.key)).toEqual(['2026-07-13', '2026-07-06']);
      expect(out[0]).toMatchObject({ entryCount: 0, recordedCount: 1, isEmpty: true, opening: 100, closing: 100 });
      expect(out[1]).toMatchObject({ entryCount: 1, recordedCount: 0, lateCount: 1, isEmpty: false });
    });
  });

  describe('month grouping (PKT calendar months)', () => {
    it('splits on the month boundary; clamps partial first/last bounds; label is "Mon YYYY"', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'month',
        rows: [cashIn('2026-07-20', 100), cashIn('2026-07-31', 50), cashIn('2026-08-01', 7), expenseRow('2026-08-15', 20)],
        broughtForward: 10,
        from: '2026-07-15',
        to: '2026-08-20',
      });

      expect(out.map((r) => r.key)).toEqual(['2026-08', '2026-07']);
      expect(out.map((r) => r.label)).toEqual(['Aug 2026', 'Jul 2026']);
      expect(out.map((r) => [r.from, r.to])).toEqual([
        ['2026-08-01', '2026-08-20'],
        ['2026-07-15', '2026-07-31'],
      ]);
      expect(out[1]).toMatchObject({ opening: 10, sheetCashIn: 150, net: 150, closing: 160, entryCount: 2 });
      expect(out[0]).toMatchObject({ opening: 160, sheetCashIn: 7, officeExpenses: 20, net: -13, closing: 147 });
    });

    it('30 Sep / 1 Oct (a day at each side of a month boundary) -> two months', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'month',
        rows: [cashIn('2026-09-30', 100), cashIn('2026-10-01', 40)],
        broughtForward: 0,
        from: '2026-09-30',
        to: '2026-10-01',
      });
      expect(out.map((r) => [r.key, r.from, r.to, r.sheetCashIn])).toEqual([
        ['2026-10', '2026-10-01', '2026-10-01', 40],
        ['2026-09', '2026-09-30', '2026-09-30', 100],
      ]);
    });

    it('a February month end is computed correctly (28 days, non-leap)', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'month',
        rows: [cashIn('2026-02-10', 1)],
        broughtForward: 0,
        from: '2026-01-01',
        to: '2026-12-31',
      });
      expect(out[0]).toMatchObject({ key: '2026-02', from: '2026-02-01', to: '2026-02-28', label: 'Feb 2026' });
    });
  });

  describe('counts', () => {
    it('lateCount / editedCount / voidedCount / entryCount (voided included)', () => {
      const rows = [
        cashIn('2026-09-10', 100),
        expenseRow('2026-09-10', 30, { isEdited: true }),
        row(noon('2026-09-10'), 'CREW_CASH', 0, { isVoided: true }), // voided folds as 0
        cashIn('2026-09-10', 5, { createdAt: noon('2026-09-13') }), // backdated 3 days
        cashIn('2026-09-11', 5),
      ];
      const { rows: out, totals } = buildDailySummary({ ...base, rows, broughtForward: 0, from: '2026-09-10', to: '2026-09-11' });
      expect(out[1]).toMatchObject({
        key: '2026-09-10',
        entryCount: 4,
        lateCount: 1,
        editedCount: 1,
        voidedCount: 1,
        crewCash: 0,
        sheetCashIn: 105,
      });
      expect(out[0]).toMatchObject({ entryCount: 1, lateCount: 0, editedCount: 0, voidedCount: 0 });
      expect(totals).toMatchObject({ entryCount: 5, lateCount: 1 });
    });

    it('recordedCount vs entryCount for a backdated entry (day rows)', () => {
      const rows = [cashIn('2026-09-10', 100, { createdAt: noon('2026-09-12') })];
      const { rows: out } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows,
        broughtForward: 0,
        from: '2026-09-10',
        to: '2026-09-12',
      });
      expect(out.find((r) => r.key === '2026-09-10')).toMatchObject({ entryCount: 1, recordedCount: 0, lateCount: 1 });
      expect(out.find((r) => r.key === '2026-09-11')).toMatchObject({ entryCount: 0, recordedCount: 0 });
      expect(out.find((r) => r.key === '2026-09-12')).toMatchObject({ entryCount: 0, recordedCount: 1, isEmpty: true });
    });

    it('a recorded-only day is NOT shown without includeEmpty (spec: activity or pending only)', () => {
      const rows = [cashIn('2026-09-10', 100, { createdAt: noon('2026-09-12') })];
      const { rows: out } = buildDailySummary({ ...base, rows, broughtForward: 0, from: '2026-09-10', to: '2026-09-12' });
      expect(out.map((r) => r.key)).toEqual(['2026-09-10']);
    });

    it('pendingCount: a pending-only day appears without includeEmpty (not "empty"); grouped sums; totals.pendingCount', () => {
      const rows = [cashIn('2026-07-06', 100)];
      const day = buildDailySummary({
        ...base,
        rows,
        broughtForward: 0,
        from: '2026-07-01',
        to: '2026-07-31',
        pendingDays: ['2026-07-08', '2026-07-08', '2026-07-06'],
      });
      expect(day.rows.map((r) => [r.key, r.pendingCount, r.isEmpty, r.entryCount])).toEqual([
        ['2026-07-08', 2, false, 0],
        ['2026-07-06', 1, false, 1],
      ]);
      // the pending-only day carries the balance and contributes no cash
      expect(day.rows[0]).toMatchObject({ opening: 100, closing: 100, net: 0 });
      expect(day.totals.pendingCount).toBe(3);

      const week = buildDailySummary({
        ...base,
        group: 'week',
        rows,
        broughtForward: 0,
        from: '2026-07-01',
        to: '2026-07-31',
        pendingDays: ['2026-07-08', '2026-07-08', '2026-07-06'],
      });
      expect(week.rows).toHaveLength(1);
      expect(week.rows[0]).toMatchObject({ key: '2026-07-06', pendingCount: 3, entryCount: 1 });
    });
  });

  describe('range derivation', () => {
    it('from absent -> the first row day; to absent -> today (PKT)', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows: [cashIn('2026-09-10', 100), cashIn('2026-09-11', 5)],
        broughtForward: 0,
        today: '2026-09-14',
      });
      expect(out.map((r) => r.key)).toEqual(['2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10']);
      expect(out[0]).toMatchObject({ opening: 105, closing: 105, isEmpty: true });
    });

    it('to present, from absent -> first row day .. to', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows: [cashIn('2026-09-10', 100)],
        broughtForward: 0,
        to: '2026-09-12',
        today: '2026-12-01',
      });
      expect(out.map((r) => r.key)).toEqual(['2026-09-12', '2026-09-11', '2026-09-10']);
    });

    it('week clamps use the derived range', () => {
      const { rows: out } = buildDailySummary({
        ...base,
        group: 'week',
        rows: [cashIn('2026-07-08', 1)],
        broughtForward: 0,
        today: '2026-07-10',
      });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ key: '2026-07-06', from: '2026-07-08', to: '2026-07-10', label: '8 – 10 Jul 2026' });
    });

    it('a future-dated row beyond derived `to` is still summed (rows always add up to totals)', () => {
      const { rows: out, totals } = buildDailySummary({
        ...base,
        rows: [cashIn('2026-09-10', 100), cashIn('2026-09-20', 7)],
        broughtForward: 0,
        today: '2026-09-14',
      });
      expect(out.map((r) => r.key)).toEqual(['2026-09-20', '2026-09-10']);
      expect(out.reduce((s, r) => s + r.net, 0)).toBe(totals.net);
    });

    it('no rows, no bounds, includeEmpty -> a single row for today carrying broughtForward', () => {
      const { rows: out } = buildDailySummary({ ...base, includeEmpty: true, rows: [], broughtForward: 75, today: '2026-09-14' });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ key: '2026-09-14', opening: 75, closing: 75, isEmpty: true });
    });
  });

  describe('I1: rows reconcile with the whole-range statement', () => {
    const rows = [
      cashIn('2026-09-01', 5000),
      expenseRow('2026-09-01', 700),
      row(noon('2026-09-03'), 'OWNER_TRANSFER', -1000),
      row(noon('2026-09-03'), 'FUEL_CARD', -200),
      row(noon('2026-09-08'), 'PAYROLL_CASH', -1300),
      row(noon('2026-09-09'), 'CREW_CASH', -100),
      row(noon('2026-09-09'), 'OFFICE_CASH_IN', 250),
      cashIn('2026-09-14', 3000),
      expenseRow('2026-09-30', 10),
    ];

    for (const group of ['day', 'week', 'month'] as const) {
      for (const includeEmpty of [false, true]) {
        it(`group=${group} includeEmpty=${includeEmpty}: sums == statement, chain holds, newest closing == expectedClosing`, () => {
          const { rows: out, totals } = buildDailySummary({
            ...base,
            group,
            includeEmpty,
            rows,
            broughtForward: 1234.5,
            from: '2026-08-28',
            to: '2026-09-30',
          });
          const statement = buildStatement(rows, 1234.5);

          for (const key of [
            'sheetCashIn',
            'officeCashIn',
            'totalCashIn',
            'officeExpenses',
            'payrollCash',
            'crewCash',
            'totalExpenses',
            'ownerTransfer',
            'fuelCard',
            'net',
          ] as const) {
            expect(Math.round(out.reduce((s, r) => s + r[key], 0) * 100) / 100).toBe(statement[key]);
            expect(totals[key]).toBe(statement[key]);
          }
          expect(totals.broughtForward).toBe(statement.broughtForward);
          expect(totals.expectedClosing).toBe(statement.expectedClosing);
          expect(out[0].closing).toBe(totals.expectedClosing);
          expect(out[out.length - 1].opening).toBe(1234.5);
          for (let i = 0; i < out.length - 1; i++) expect(out[i].opening).toBe(out[i + 1].closing);
          for (const r of out) expect(Math.round((r.opening + r.net) * 100) / 100).toBe(r.closing);
          expect(out.reduce((s, r) => s + r.entryCount, 0)).toBe(rows.length);
          expect(totals.entryCount).toBe(rows.length);
        });
      }
    }
  });

  describe('row cap', () => {
    it(`caps at ${DAILY_SUMMARY_ROW_CAP} AFTER grouping: drops the OLDEST rows, sets truncated, totals stay whole-range`, () => {
      const rows = [cashIn('2025-01-01', 100), cashIn('2026-01-02', 1)];
      const full = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows,
        broughtForward: 0,
        from: '2025-01-01',
        to: '2026-01-02',
      });
      expect(full.truncated).toBe(true);
      expect(full.rows).toHaveLength(DAILY_SUMMARY_ROW_CAP);
      expect(full.rows[0].key).toBe('2026-01-02');
      expect(full.rows[DAILY_SUMMARY_ROW_CAP - 1].key).toBe('2025-01-02'); // 2025-01-01 (oldest) dropped
      expect(full.totals.entryCount).toBe(2);
      expect(full.totals.expectedClosing).toBe(101);
      // the surviving oldest row still opens where the dropped row closed
      expect(full.rows[DAILY_SUMMARY_ROW_CAP - 1].opening).toBe(100);
    });

    it('exactly 366 rows is not truncated', () => {
      const out = buildDailySummary({
        ...base,
        includeEmpty: true,
        rows: [],
        broughtForward: 0,
        from: '2025-01-01',
        to: '2026-01-01',
      });
      expect(out.rows).toHaveLength(366);
      expect(out.truncated).toBe(false);
    });

    it('the cap applies to GROUPED rows (a year of days fits in 13 weekly/12 monthly rows)', () => {
      const out = buildDailySummary({
        ...base,
        group: 'week',
        includeEmpty: true,
        rows: [],
        broughtForward: 0,
        from: '2025-01-01',
        to: '2026-01-02',
      });
      expect(out.truncated).toBe(false);
      expect(out.rows.length).toBeLessThan(60);
    });
  });
});
