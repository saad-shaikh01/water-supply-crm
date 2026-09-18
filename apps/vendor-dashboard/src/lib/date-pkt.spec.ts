import {
  addDaysYmd,
  addMonthsYmd,
  pktToday,
  rangeLast3Months,
  rangeLastMonth,
  rangeThisMonth,
  rangeThisWeek,
  rangeThisYear,
  rangeToday,
  rangeYesterday,
  startOfWeekYmd,
} from './date-pkt';

// PKT = UTC+5. 2026-03-31T20:30Z is 2026-04-01 01:30 in Karachi (UTC day is still March 31).
const AFTER_MIDNIGHT_PKT = new Date('2026-03-31T20:30:00Z');
// 2026-09-18T18:59Z is 2026-09-18 23:59 in Karachi.
const LATE_EVENING_PKT = new Date('2026-09-18T18:59:00Z');

describe('date-pkt', () => {
  describe('pktToday', () => {
    it('uses the Karachi calendar day, not the UTC day, between 00:00 and 05:00 PKT', () => {
      expect(pktToday(AFTER_MIDNIGHT_PKT)).toBe('2026-04-01');
      expect(AFTER_MIDNIGHT_PKT.toISOString().slice(0, 10)).toBe('2026-03-31');
    });

    it('stays on the same day just before PKT midnight', () => {
      expect(pktToday(LATE_EVENING_PKT)).toBe('2026-09-18');
    });
  });

  describe('presets at 00:30 PKT on the 1st (month boundary)', () => {
    it('Today / Yesterday', () => {
      expect(rangeToday(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-04-01', to: '2026-04-01' });
      expect(rangeYesterday(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-03-31', to: '2026-03-31' });
    });

    it('This Month starts on the 1st of the PKT month', () => {
      expect(rangeThisMonth(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    });

    it('Last Month is the whole previous PKT month', () => {
      expect(rangeLastMonth(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    });

    it('This Week starts on Monday (2026-04-01 is a Wednesday)', () => {
      expect(rangeThisWeek(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-03-30', to: '2026-04-01' });
    });

    it('This Year / Last 3 Months', () => {
      expect(rangeThisYear(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-01-01', to: '2026-04-01' });
      expect(rangeLast3Months(AFTER_MIDNIGHT_PKT)).toEqual({ from: '2026-01-01', to: '2026-04-01' });
    });
  });

  describe('calendar arithmetic', () => {
    it('handles year boundaries', () => {
      const jan = new Date('2027-01-10T08:00:00Z');
      expect(rangeLastMonth(jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
      expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('Last Month handles leap-year February', () => {
      expect(rangeLastMonth(new Date('2028-03-15T08:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
      expect(rangeLastMonth(new Date('2027-03-15T08:00:00Z'))).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    });

    it('clamps the day when subtracting months', () => {
      expect(addMonthsYmd('2026-05-31', -3)).toBe('2026-02-28');
      expect(addMonthsYmd('2026-03-31', -1)).toBe('2026-02-28');
      expect(addMonthsYmd('2026-01-15', -2)).toBe('2025-11-15');
    });

    it('startOfWeekYmd returns the same day on a Monday and 6 days back on a Sunday', () => {
      expect(startOfWeekYmd('2026-09-14')).toBe('2026-09-14'); // Monday
      expect(startOfWeekYmd('2026-09-20')).toBe('2026-09-14'); // Sunday
    });
  });
});
