import { BadRequestException } from '@nestjs/common';
import {
  hasActiveFilters,
  matchesFilters,
  normalizeSearch,
  resolveTimelineFilters,
  summarizeFiltered,
  type FilterableLedgerRow,
} from './cash-ledger-filters';
import { mergePendingRows } from './cash-ledger-pending';

function row(over: Partial<FilterableLedgerRow> = {}): FilterableLedgerRow {
  return {
    type: 'CASH_OUT',
    bucket: 'OFFICE_EXPENSE',
    createdAt: '2026-09-10T06:00:00.000Z',
    amount: -500,
    displayAmount: 500,
    status: null,
    isVoided: false,
    lagDays: 0,
    isEdited: false,
    hasAttachment: false,
    notes: null,
    title: 'Office tea',
    ...over,
  };
}

const pick = (rows: FilterableLedgerRow[], filters: Parameters<typeof matchesFilters>[1]) =>
  rows.filter((r) => matchesFilters(r, filters));

describe('cash-ledger-filters (pure)', () => {
  describe('hasActiveFilters', () => {
    it('is false for undefined / empty / inert values', () => {
      expect(hasActiveFilters(undefined)).toBe(false);
      expect(hasActiveFilters({})).toBe(false);
      expect(
        hasActiveFilters({ q: ' a ', buckets: [], status: [], backdatedOnly: false, hasNote: false, sheet: '#', reference: ' ' }),
      ).toBe(false);
    });

    it('is true for each individual filter', () => {
      expect(hasActiveFilters({ q: 'tea' })).toBe(true);
      expect(hasActiveFilters({ buckets: ['CREW_CASH'] })).toBe(true);
      expect(hasActiveFilters({ status: ['PENDING'] })).toBe(true);
      expect(hasActiveFilters({ recordedFrom: '2026-09-01' })).toBe(true);
      expect(hasActiveFilters({ backdatedOnly: true })).toBe(true);
      expect(hasActiveFilters({ minAmount: 0 })).toBe(true);
      expect(hasActiveFilters({ maxAmount: 10 })).toBe(true);
      expect(hasActiveFilters({ sheet: 'A1' })).toBe(true);
      expect(hasActiveFilters({ destination: 'BANK' })).toBe(true);
      expect(hasActiveFilters({ extraLabourId: 'labour-1' })).toBe(true);
    });
  });

  describe('individual filters', () => {
    it('no filter keeps every row', () => {
      const rows = [row(), row({ bucket: 'CREW_CASH' })];
      expect(pick(rows, {})).toHaveLength(2);
      expect(pick(rows, undefined)).toHaveLength(2);
    });

    it('buckets: OR within the list', () => {
      const rows = [row({ bucket: 'CREW_CASH' }), row({ bucket: 'FUEL_CARD' }), row({ bucket: 'OFFICE_EXPENSE' })];
      expect(pick(rows, { buckets: ['CREW_CASH', 'FUEL_CARD'] }).map((r) => r.bucket)).toEqual(['CREW_CASH', 'FUEL_CARD']);
    });

    it('status: PENDING / VOIDED / CORRECTED / APPROVED', () => {
      const pending = row({ type: 'CASH_IN', bucket: 'SHEET_CASH_IN', status: 'PENDING', amount: 0, displayAmount: 700 });
      const voided = row({ isVoided: true, amount: 0 });
      const corrHandover = row({ type: 'CASH_IN_CORRECTION', bucket: 'SHEET_CASH_IN', status: 'APPROVED' });
      const corrRemit = row({ type: 'CASH_REMITTANCE_OUT', bucket: 'OWNER_TRANSFER', isCorrection: true });
      const plain = row();
      const rows = [pending, voided, corrHandover, corrRemit, plain];

      expect(pick(rows, { status: ['PENDING'] })).toEqual([pending]);
      expect(pick(rows, { status: ['VOIDED'] })).toEqual([voided]);
      expect(pick(rows, { status: ['CORRECTED'] })).toEqual([corrHandover, corrRemit]);
      // APPROVED = not pending and not voided; rows without an approval concept count.
      expect(pick(rows, { status: ['APPROVED'] })).toEqual([corrHandover, corrRemit, plain]);
      // OR inside the group.
      expect(pick(rows, { status: ['PENDING', 'VOIDED'] })).toEqual([pending, voided]);
    });

    it('recordedFrom / recordedTo use the PKT day of createdAt, inclusive (23:30 PKT vs 00:30 PKT)', () => {
      // 2026-09-10T18:30Z = 23:30 PKT on 10 Sep ; 2026-09-10T19:30Z = 00:30 PKT on 11 Sep.
      const late10 = row({ createdAt: '2026-09-10T18:30:00.000Z', title: 'late10' });
      const early11 = row({ createdAt: '2026-09-10T19:30:00.000Z', title: 'early11' });
      const rows = [late10, early11];

      expect(pick(rows, { recordedFrom: '2026-09-11' }).map((r) => r.title)).toEqual(['early11']);
      expect(pick(rows, { recordedTo: '2026-09-10' }).map((r) => r.title)).toEqual(['late10']);
      expect(pick(rows, { recordedFrom: '2026-09-10', recordedTo: '2026-09-10' }).map((r) => r.title)).toEqual(['late10']);
      expect(pick(rows, { recordedFrom: '2026-09-10', recordedTo: '2026-09-11' })).toHaveLength(2);
      // An ISO instant bound is reduced to its PKT day.
      expect(pick(rows, { recordedFrom: '2026-09-10T19:30:00.000Z' }).map((r) => r.title)).toEqual(['early11']);
    });

    it('backdatedOnly (lagDays > 0) and editedOnly', () => {
      const backdated = row({ lagDays: 2, title: 'b' });
      const future = row({ lagDays: -1, title: 'f' });
      const edited = row({ isEdited: true, title: 'e' });
      const rows = [backdated, future, edited, row()];
      expect(pick(rows, { backdatedOnly: true }).map((r) => r.title)).toEqual(['b']);
      expect(pick(rows, { editedOnly: true }).map((r) => r.title)).toEqual(['e']);
      // `false` is "filter off", not "exclude".
      expect(pick(rows, { backdatedOnly: false, editedOnly: false })).toHaveLength(4);
    });

    it('recordedById / approvedById are equality filters', () => {
      const a = row({ recordedById: 'u1', approvedById: 'm1' });
      const b = row({ recordedById: 'u2', approvedById: null });
      expect(pick([a, b], { recordedById: 'u1' })).toEqual([a]);
      expect(pick([a, b], { approvedById: 'm1' })).toEqual([a]);
    });

    it('employeeId matches the row employee OR (handover family) the submitting driver', () => {
      const crew = row({ bucket: 'CREW_CASH', type: 'STANDALONE_CREW_CASH_OUT', employeeId: 'emp' });
      const handover = row({ bucket: 'SHEET_CASH_IN', type: 'CASH_IN', recordedById: 'emp' });
      const correction = row({ bucket: 'SHEET_CASH_IN', type: 'CASH_IN_CORRECTION', recordedById: 'emp' });
      // recordedById on a NON-handover row is the accountant, not an employee link.
      const expense = row({ recordedById: 'emp' });
      const other = row({ employeeId: 'someone' });
      expect(pick([crew, handover, correction, expense, other], { employeeId: 'emp' })).toEqual([crew, handover, correction]);
    });

    it('extraLabourId is a plain equality filter, independent of employeeId', () => {
      const paid = row({ bucket: 'OFFICE_EXPENSE', extraLabourId: 'labour-1' });
      const other = row({ bucket: 'OFFICE_EXPENSE', extraLabourId: 'labour-2' });
      const unset = row({ bucket: 'OFFICE_EXPENSE' });
      // A row sharing the same id in the (distinct) employeeId space never matches.
      const sameIdWrongField = row({ bucket: 'CREW_CASH', employeeId: 'labour-1' });
      expect(pick([paid, other, unset, sameIdWrongField], { extraLabourId: 'labour-1' })).toEqual([paid]);
    });

    it('categories: row.category in the list', () => {
      const meal = row({ category: 'MEAL' });
      const fuel = row({ category: 'FUEL' });
      const none = row();
      expect(pick([meal, fuel, none], { categories: ['MEAL', 'REPAIR'] })).toEqual([meal]);
    });

    it('min / max amount on displayAmount (inclusive), so voided rows keep their magnitude', () => {
      const small = row({ displayAmount: 100 });
      const mid = row({ displayAmount: 500 });
      const voided = row({ displayAmount: 900, amount: 0, isVoided: true });
      const rows = [small, mid, voided];
      expect(pick(rows, { minAmount: 500 })).toEqual([mid, voided]);
      expect(pick(rows, { maxAmount: 500 })).toEqual([small, mid]);
      expect(pick(rows, { minAmount: 200, maxAmount: 600 })).toEqual([mid]);
      expect(pick(rows, { minAmount: 0 })).toHaveLength(3);
    });

    it('hasAttachment / hasNote', () => {
      const att = row({ hasAttachment: true });
      const note = row({ notes: 'paid in cash' });
      const blank = row({ notes: '   ' });
      expect(pick([att, note, blank, row()], { hasAttachment: true })).toEqual([att]);
      expect(pick([att, note, blank, row()], { hasNote: true })).toEqual([note]);
    });

    it('sheet: case-insensitive short-id prefix, leading # stripped', () => {
      const a = row({ dailySheetId: 'a1b2c3d4-0000-4000-8000-000000000000' });
      const b = row({ dailySheetId: 'ffff0000-0000-4000-8000-000000000000' });
      const none = row({ dailySheetId: null });
      expect(pick([a, b, none], { sheet: '#a1b2' })).toEqual([a]);
      expect(pick([a, b, none], { sheet: 'A1B2C3D4' })).toEqual([a]);
      expect(pick([a, b, none], { sheet: 'a' })).toEqual([a]);
      expect(pick([a, b, none], { sheet: 'zz' })).toEqual([]);
    });

    it('reference: case-insensitive contains', () => {
      const a = row({ reference: 'TRX-991' });
      const b = row({ reference: null });
      expect(pick([a, b], { reference: 'trx-9' })).toEqual([a]);
    });

    it('destination: equality', () => {
      const bank = row({ destination: 'BANK' });
      const owner = row({ destination: 'OWNER' });
      expect(pick([bank, owner, row()], { destination: 'BANK' })).toEqual([bank]);
    });
  });

  describe('search (q)', () => {
    const hits: Array<[string, Partial<FilterableLedgerRow>, string]> = [
      ['title', { title: 'Generator diesel' }, 'DIESEL'],
      ['notes', { notes: 'Paid to mechanic Zafar' }, 'zafar'],
      ['reference', { reference: 'CHQ-7788' }, 'chq-77'],
      ['employeeName', { employeeName: 'Bilal Ahmed' }, 'bilal'],
      ['vanPlateNumber', { vanPlateNumber: 'ABC-123' }, 'abc-1'],
      ['categoryLabel', { categoryLabel: 'Vehicle Repair' }, 'repair'],
      ['sourceBadge', { sourceBadge: 'via Payroll' }, 'payroll'],
      ['recordedByName', { recordedByName: 'Accountant Sana' }, 'sana'],
      ['approvedByName', { approvedByName: 'Admin Omar' }, 'omar'],
      ['short sheet id', { dailySheetId: 'a1b2c3d4-0000-4000-8000-000000000000' }, 'a1b2c3'],
    ];
    it.each(hits)('matches on %s (case-insensitive)', (_field, over, q) => {
      const target = row({ title: 'zzz', ...over });
      const miss = row({ title: 'nothing relevant' });
      expect(pick([target, miss], { q })).toEqual([target]);
    });

    it('ignores a query shorter than 2 chars after trim (filter inactive)', () => {
      const rows = [row({ title: 'abc' }), row({ title: 'xyz' })];
      expect(normalizeSearch(' a ')).toBeNull();
      expect(pick(rows, { q: 'a' })).toHaveLength(2);
      expect(pick(rows, { q: '  a  ' })).toHaveLength(2);
      expect(pick(rows, { q: 'ab' })).toHaveLength(1);
    });

    it('a numeric q also matches an exact whole-rupee displayAmount', () => {
      const target = row({ displayAmount: 1500, title: 'x1' });
      const other = row({ displayAmount: 15000, title: 'x2' });
      expect(pick([target, other], { q: '1500' })).toEqual([target]);
      expect(pick([target, other], { q: '1,500' })).toEqual([target]);
    });
  });

  describe('AND across groups, OR within', () => {
    it('buckets [CREW_CASH, FUEL_CARD] AND recordedBy X', () => {
      const crewX = row({ bucket: 'CREW_CASH', recordedById: 'X' });
      const fuelX = row({ bucket: 'FUEL_CARD', recordedById: 'X' });
      const crewY = row({ bucket: 'CREW_CASH', recordedById: 'Y' });
      const expX = row({ bucket: 'OFFICE_EXPENSE', recordedById: 'X' });
      expect(pick([crewX, fuelX, crewY, expX], { buckets: ['CREW_CASH', 'FUEL_CARD'], recordedById: 'X' })).toEqual([
        crewX,
        fuelX,
      ]);
    });
  });

  describe('summarizeFiltered', () => {
    it('totalIn = Σ positive amount, totalOut = Σ |negative amount|; zero-amount rows only count', () => {
      const s = summarizeFiltered([
        { amount: 1000 },
        { amount: 250.5 },
        { amount: -400 },
        { amount: -0.25 },
        { amount: 0 }, // voided / pending memo
      ]);
      expect(s).toEqual({ count: 5, totalIn: 1250.5, totalOut: 400.25 });
    });

    it('empty', () => {
      expect(summarizeFiltered([])).toEqual({ count: 0, totalIn: 0, totalOut: 0 });
    });
  });

  describe('resolveTimelineFilters', () => {
    it('merges the key[] aliases into the canonical lists (deduped)', () => {
      const f = resolveTimelineFilters({
        buckets: ['CREW_CASH'],
        'buckets[]': ['CREW_CASH', 'FUEL_CARD'],
        'status[]': ['PENDING'],
        'categories[]': ['MEAL'],
      });
      expect(f.buckets).toEqual(['CREW_CASH', 'FUEL_CARD']);
      expect(f.status).toEqual(['PENDING']);
      expect(f.categories).toEqual(['MEAL']);
    });

    it('rejects minAmount > maxAmount with a 400', () => {
      expect(() => resolveTimelineFilters({ minAmount: 10, maxAmount: 5 })).toThrow(BadRequestException);
      expect(() => resolveTimelineFilters({ minAmount: 5, maxAmount: 5 })).not.toThrow();
    });
  });
});

describe('mergePendingRows', () => {
  const r = (id: string, date: string, balance: number, amount = 0) => ({
    id,
    date,
    createdAt: date,
    bucket: 'SHEET_CASH_IN' as const,
    runningBalance: balance,
    amount,
  });

  it('inserts pending rows in ledger order carrying the preceding base balance; base rows untouched', () => {
    const base = [r('a', '2026-09-01T05:00:00Z', 100, 100), r('c', '2026-09-03T05:00:00Z', 250, 150)];
    const pending = [r('p1', '2026-09-02T05:00:00Z', 0), r('p0', '2026-08-30T05:00:00Z', 0)];
    const merged = mergePendingRows(base, pending, 0);
    expect(merged.map((m) => m.id)).toEqual(['p0', 'a', 'p1', 'c']);
    expect(merged.map((m) => m.runningBalance)).toEqual([0, 100, 100, 250]);
    expect(base.map((b) => b.runningBalance)).toEqual([100, 250]);
  });

  it('a pending row before every base row takes the brought-forward balance', () => {
    const merged = mergePendingRows([r('a', '2026-09-05T05:00:00Z', 900, 100)], [r('p', '2026-09-01T05:00:00Z', 0)], 800);
    expect(merged.map((m) => [m.id, m.runningBalance])).toEqual([
      ['p', 800],
      ['a', 900],
    ]);
  });

  it('no pending rows -> same rows', () => {
    const base = [r('a', '2026-09-01T05:00:00Z', 100, 100)];
    expect(mergePendingRows(base, [], 0)).toEqual(base);
  });
});
