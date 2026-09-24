import {
  buildHistoryEvent,
  diffChanges,
  extractHistoryReason,
  normalizeHistoryAction,
  sortHistoryEvents,
} from './cash-ledger-history';

describe('cash-ledger-history (pure helpers)', () => {
  describe('normalizeHistoryAction', () => {
    it.each([
      ['CREATE', 'CREATED'],
      ['CREATED', 'CREATED'],
      ['CLOSED_EXPENSE_ADDED', 'CREATED'],
      ['UPDATED', 'UPDATED'],
      ['EDITED', 'UPDATED'],
      ['APPROVED', 'APPROVED'],
      ['CORRECTED', 'CORRECTED'],
      ['CLOSED_EXPENSE_CORRECTED', 'CORRECTED'],
      ['VOIDED', 'VOIDED'],
      ['DELETED', 'VOIDED'],
      ['CLOSED_EXPENSE_VOIDED', 'VOIDED'],
      ['REVERSED', 'REVERSED'],
      ['ROLLED_INTO_PAYROLL', 'OTHER'],
      ['whatever', 'OTHER'],
    ])('%s -> %s', (raw, expected) => {
      expect(normalizeHistoryAction(raw)).toBe(expected);
    });
  });

  describe('extractHistoryReason', () => {
    it('prefers changes.reason, then the legacy after.* keys, then before.correctionNote', () => {
      expect(extractHistoryReason({ reason: 'canonical', after: { voidReason: 'legacy' } })).toBe('canonical');
      expect(extractHistoryReason({ after: { voidReason: 'v', adjustmentReason: 'a' } })).toBe('v');
      expect(extractHistoryReason({ after: { adjustmentReason: 'a', correctionReason: 'c' } })).toBe('a');
      expect(extractHistoryReason({ after: { correctionReason: 'c' } })).toBe('c');
      expect(extractHistoryReason({ before: { correctionNote: 'n' } })).toBe('n');
      expect(extractHistoryReason({ reason: '   ' })).toBeNull();
      expect(extractHistoryReason(null)).toBeNull();
    });
  });

  describe('diffChanges', () => {
    it('lists only keys present in either side whose normalised values differ', () => {
      const changes = diffChanges(
        { amount: 100, note: 'same', paidFromCash: true, gone: 'x' },
        { amount: '150', note: 'same', paidFromCash: true, fresh: 7 },
      );
      expect(changes.map((c) => c.field)).toEqual(['amount', 'gone', 'fresh']);
      // Money values are coerced to numbers; unknown keys fall back to text via String().
      expect(changes[0]).toEqual({ field: 'amount', label: 'Amount', before: 100, after: 150, kind: 'money' });
      expect(changes[1]).toEqual({ field: 'gone', label: 'Gone', before: 'x', after: null, kind: 'text' });
      expect(changes[2]).toEqual({ field: 'fresh', label: 'Fresh', before: null, after: '7', kind: 'text' });
    });

    it('treats the same instant written two ways as unchanged (dates compared as PKT days)', () => {
      expect(
        diffChanges({ openingDate: '2026-09-10T00:00:00.000Z' }, { openingDate: '2026-09-10T10:00:00.000Z' }),
      ).toEqual([]);
    });

    it('skips reason keys and non-object inputs', () => {
      expect(diffChanges({ voidReason: 'a' }, { voidReason: 'b', correctionNote: 'c' })).toEqual([]);
      expect(diffChanges(null, undefined)).toEqual([]);
    });
  });

  describe('buildHistoryEvent / sortHistoryEvents', () => {
    it('newest first, CREATED last on a tie', () => {
      const mk = (id: string, rawAction: string, at: string) =>
        buildHistoryEvent(
          { id, rawAction, at: new Date(at), actorName: null, changes: {}, source: 'AUDIT_LOG' },
          { vans: new Map(), users: new Map(), vehicles: new Map() },
        );
      const sorted = sortHistoryEvents([
        mk('created', 'CREATED', '2026-09-10T06:00:00Z'),
        mk('same-instant', 'UPDATED', '2026-09-10T06:00:00Z'),
        mk('latest', 'UPDATED', '2026-09-12T06:00:00Z'),
      ]);
      expect(sorted.map((e) => e.id)).toEqual(['latest', 'same-instant', 'created']);
    });
  });
});
