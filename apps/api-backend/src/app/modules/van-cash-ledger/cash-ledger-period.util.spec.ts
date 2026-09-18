import {
  currentPeriodLabel,
  hasPeriodEnded,
  isPeriodLabel,
  nextPeriodLabel,
  periodBounds,
  periodDisplayLabel,
  periodLabelOf,
  previousPeriodLabel,
  redirectDateForToday,
} from './cash-ledger-period.util';

describe('cash-ledger-period util', () => {
  describe('isPeriodLabel', () => {
    it.each(['2026-01', '2026-12', '1999-09'])('accepts %s', (v) => expect(isPeriodLabel(v)).toBe(true));
    it.each(['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', 'abcd-ef'])('rejects %s', (v) =>
      expect(isPeriodLabel(v)).toBe(false),
    );
  });

  describe('periodLabelOf (PKT calendar month)', () => {
    it('23:30 PKT on the last day of the month is still that month; 00:30 PKT on the 1st is the next', () => {
      // 2026-08-31T18:30Z = 23:30 PKT 31 Aug ; 2026-08-31T19:30Z = 00:30 PKT 1 Sep
      expect(periodLabelOf(new Date('2026-08-31T18:30:00.000Z'))).toBe('2026-08');
      expect(periodLabelOf(new Date('2026-08-31T19:30:00.000Z'))).toBe('2026-09');
    });

    it('year boundary in PKT', () => {
      expect(periodLabelOf(new Date('2026-12-31T18:59:59.999Z'))).toBe('2026-12');
      expect(periodLabelOf(new Date('2026-12-31T19:00:00.000Z'))).toBe('2027-01');
    });

    it('a bare YYYY-MM-DD is taken literally; an ISO string is bucketed by its PKT day', () => {
      expect(periodLabelOf('2026-09-01')).toBe('2026-09');
      expect(periodLabelOf('2026-08-31T20:00:00.000Z')).toBe('2026-09');
    });

    it('date-only UTC-midnight business dates (sheet / ledger convention) stay in their own month', () => {
      expect(periodLabelOf(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09');
      expect(periodLabelOf(new Date('2026-08-31T00:00:00.000Z'))).toBe('2026-08');
    });
  });

  describe('periodBounds', () => {
    it('non-leap February ends on the 28th, leap on the 29th', () => {
      expect(periodBounds('2026-02').lastDay).toBe('2026-02-28');
      expect(periodBounds('2028-02').lastDay).toBe('2028-02-29');
      expect(periodBounds('2100-02').lastDay).toBe('2100-02-28'); // century, not leap
    });

    it('31- and 30-day months', () => {
      expect(periodBounds('2026-08').lastDay).toBe('2026-08-31');
      expect(periodBounds('2026-09').lastDay).toBe('2026-09-30');
      expect(periodBounds('2026-12').lastDay).toBe('2026-12-31');
    });

    it('start / end are the PKT first instant and last millisecond (UTC+5)', () => {
      const b = periodBounds('2026-09');
      expect(b.firstDay).toBe('2026-09-01');
      expect(b.startDate.toISOString()).toBe('2026-08-31T19:00:00.000Z');
      expect(b.endDate.toISOString()).toBe('2026-09-30T18:59:59.999Z');
    });

    it('throws on a malformed label', () => {
      expect(() => periodBounds('2026-9')).toThrow();
    });
  });

  describe('previous / next across the year', () => {
    it('previousPeriodLabel', () => {
      expect(previousPeriodLabel('2026-09')).toBe('2026-08');
      expect(previousPeriodLabel('2026-01')).toBe('2025-12');
    });
    it('nextPeriodLabel', () => {
      expect(nextPeriodLabel('2026-09')).toBe('2026-10');
      expect(nextPeriodLabel('2026-12')).toBe('2027-01');
    });
  });

  it('periodDisplayLabel', () => {
    expect(periodDisplayLabel('2026-08')).toBe('Aug 2026');
    expect(periodDisplayLabel('2027-01')).toBe('Jan 2027');
  });

  describe('hasPeriodEnded / currentPeriodLabel', () => {
    it('ends only once PKT "today" is strictly after the last day', () => {
      // 2026-08-31T18:30Z = 23:30 PKT on 31 Aug -> August not over yet
      expect(hasPeriodEnded('2026-08', new Date('2026-08-31T18:30:00.000Z'))).toBe(false);
      // 00:30 PKT on 1 Sep -> August has ended
      expect(hasPeriodEnded('2026-08', new Date('2026-08-31T19:30:00.000Z'))).toBe(true);
      expect(hasPeriodEnded('2026-09', new Date('2026-09-18T05:00:00.000Z'))).toBe(false);
    });

    it('currentPeriodLabel follows PKT', () => {
      expect(currentPeriodLabel(new Date('2026-08-31T19:30:00.000Z'))).toBe('2026-09');
      expect(currentPeriodLabel(new Date('2026-08-31T18:30:00.000Z'))).toBe('2026-08');
    });
  });

  it('redirectDateForToday is the PKT day at UTC midnight', () => {
    expect(redirectDateForToday(new Date('2026-08-31T19:30:00.000Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(redirectDateForToday(new Date('2026-08-31T18:30:00.000Z')).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});
