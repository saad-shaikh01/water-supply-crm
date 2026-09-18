import type { CashLedgerBucket } from './cash-ledger-buckets';
import { compareLedgerRows, pktDay, sortLedgerRows, type SortableLedgerRow } from './cash-ledger-sort';

function row(id: string, bucket: CashLedgerBucket, date: string, createdAt: string, amount = 0) {
  return { id, bucket, date, createdAt, amount } as SortableLedgerRow & { amount: number };
}

describe('pktDay()', () => {
  it('buckets by the Asia/Karachi calendar day, not UTC', () => {
    expect(pktDay('2026-09-10T18:30:00.000Z')).toBe('2026-09-10'); // 23:30 PKT
    expect(pktDay('2026-09-10T19:30:00.000Z')).toBe('2026-09-11'); // 00:30 PKT next day
  });
});

describe('compareLedgerRows()', () => {
  it('orders by PKT day first, even when the raw UTC date strings sort the other way', () => {
    // 19:30Z on the 10th is already the 11th in PKT; 05:00Z on the 11th is the 11th too.
    const lateUtc10 = row('a', 'SHEET_CASH_IN', '2026-09-10T19:30:00.000Z', '2026-09-10T19:30:00.000Z');
    const earlyUtc11 = row('b', 'SHEET_CASH_IN', '2026-09-11T05:00:00.000Z', '2026-09-11T05:00:00.000Z');
    const day10 = row('c', 'SHEET_CASH_IN', '2026-09-10T10:00:00.000Z', '2026-09-10T10:00:00.000Z');
    const sorted = sortLedgerRows([earlyUtc11, lateUtc10, day10]);
    expect(sorted[0].id).toBe('c'); // PKT 10th
    expect(sorted.slice(1).map((r) => r.id)).toEqual(['a', 'b']); // both PKT 11th, by createdAt
  });

  it('within the same PKT day and identical date: createdAt asc decides', () => {
    const date = '2026-09-10T00:00:00.000Z';
    const later = row('a', 'SHEET_CASH_IN', date, '2026-09-10T09:00:00.000Z');
    const earlier = row('z', 'FUEL_CARD', date, '2026-09-10T08:00:00.000Z');
    expect(sortLedgerRows([later, earlier]).map((r) => r.id)).toEqual(['z', 'a']);
  });

  it('identical date + createdAt: cash-in buckets sort before cash-out buckets (never an artificial dip)', () => {
    const date = '2026-09-10T00:00:00.000Z';
    const at = '2026-09-10T08:00:00.000Z';
    // ids chosen so an id-only sort would put every cash-out FIRST ("CASH_OUT" < "OPENING_BALANCE").
    const rows = [
      row('CASH_OUT:x', 'OFFICE_EXPENSE', date, at, -4000),
      row('STANDALONE_CREW_CASH_OUT:x', 'CREW_CASH', date, at, -100),
      row('OPENING_BALANCE:x', 'OFFICE_CASH_IN', date, at, 5000),
      row('CASH_REMITTANCE_OUT:x', 'OWNER_TRANSFER', date, at, -200),
      row('CASH_IN:x', 'SHEET_CASH_IN', date, at, 1000),
      row('FUEL_CARD_TOPUP_OUT:x', 'FUEL_CARD', date, at, -300),
      row('CASH_OUT:payroll', 'PAYROLL_CASH', date, at, -400),
    ];
    const sorted = sortLedgerRows(rows);
    expect(sorted.map((r) => r.bucket)).toEqual([
      'SHEET_CASH_IN',
      'OFFICE_CASH_IN',
      'OFFICE_EXPENSE',
      'PAYROLL_CASH',
      'CREW_CASH',
      'OWNER_TRANSFER',
      'FUEL_CARD',
    ]);

    let running = 0;
    let lowest = Infinity;
    for (const r of sorted) {
      running += r.amount;
      lowest = Math.min(lowest, running);
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
  });

  it('final tie-break is the id, and equal rows compare 0', () => {
    const date = '2026-09-10T00:00:00.000Z';
    const at = '2026-09-10T08:00:00.000Z';
    const a = row('CASH_IN:a', 'SHEET_CASH_IN', date, at);
    const b = row('CASH_IN:b', 'SHEET_CASH_IN', date, at);
    expect(compareLedgerRows(a, b)).toBe(-1);
    expect(compareLedgerRows(b, a)).toBe(1);
    expect(compareLedgerRows(a, { ...a })).toBe(0);
  });

  it('does not mutate its input and is deterministic across input permutations', () => {
    const date = '2026-09-10T00:00:00.000Z';
    const rows = [
      row('c', 'CREW_CASH', date, '2026-09-10T08:00:00.000Z'),
      row('a', 'SHEET_CASH_IN', date, '2026-09-10T08:00:00.000Z'),
      row('b', 'OFFICE_EXPENSE', date, '2026-09-10T07:00:00.000Z'),
    ];
    const snapshot = rows.map((r) => r.id);
    const one = sortLedgerRows(rows).map((r) => r.id);
    const two = sortLedgerRows([...rows].reverse()).map((r) => r.id);
    expect(one).toEqual(['b', 'a', 'c']);
    expect(two).toEqual(one);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
