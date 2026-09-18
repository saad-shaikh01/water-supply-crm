import { isFutureVendorDate, vendorDateString, vendorDayEnd, vendorDayStart, vendorTodayString } from './date.util';

describe('isFutureVendorDate', () => {
  const now = new Date('2026-09-05T19:30:00.000Z'); // 00:30 PKT on 6 Sep
  it('is false for today and the past (PKT day), true for tomorrow onwards', () => {
    expect(isFutureVendorDate('2026-09-06', now)).toBe(false);
    expect(isFutureVendorDate('2026-09-05', now)).toBe(false);
    expect(isFutureVendorDate('2026-09-07', now)).toBe(true);
  });
  it('buckets a timestamp by its PKT day (UTC still says the 5th, PKT says the 6th)', () => {
    expect(isFutureVendorDate(new Date('2026-09-05T19:10:00.000Z'), now)).toBe(false);
    expect(isFutureVendorDate(new Date('2026-09-06T19:10:00.000Z'), now)).toBe(true);
  });
});

describe('vendor (Asia/Karachi) day helpers', () => {
  it('vendorDayStart is PKT midnight expressed in UTC (5h before UTC midnight)', () => {
    expect(vendorDayStart('2026-09-05').toISOString()).toBe('2026-09-04T19:00:00.000Z');
  });

  it('vendorDayEnd is the last millisecond of that PKT day', () => {
    expect(vendorDayEnd('2026-09-05').toISOString()).toBe('2026-09-05T18:59:59.999Z');
  });

  it('a date-only value stored at UTC midnight falls inside its own PKT day [start, end]', () => {
    const stored = new Date('2026-09-05T00:00:00.000Z'); // 05:00 PKT on the 5th
    expect(stored >= vendorDayStart('2026-09-05')).toBe(true);
    expect(stored <= vendorDayEnd('2026-09-05')).toBe(true);
    // ...and outside the neighbouring days.
    expect(stored <= vendorDayEnd('2026-09-04')).toBe(false);
    expect(stored >= vendorDayStart('2026-09-06')).toBe(false);
  });

  it('PKT boundary: 23:30 PKT and 00:30 PKT land on different vendor days', () => {
    const lateEvening = new Date('2026-09-05T18:30:00.000Z'); // 23:30 PKT on the 5th
    const justAfterMidnight = new Date('2026-09-05T19:30:00.000Z'); // 00:30 PKT on the 6th
    expect(vendorDateString(lateEvening)).toBe('2026-09-05');
    expect(vendorDateString(justAfterMidnight)).toBe('2026-09-06');
    expect(lateEvening <= vendorDayEnd('2026-09-05')).toBe(true);
    expect(justAfterMidnight <= vendorDayEnd('2026-09-05')).toBe(false);
    expect(justAfterMidnight >= vendorDayStart('2026-09-06')).toBe(true);
  });

  it('a full ISO timestamp input is bucketed into the PKT day it falls in', () => {
    expect(vendorDayStart('2026-09-05T20:00:00.000Z').toISOString()).toBe('2026-09-05T19:00:00.000Z'); // 01:00 PKT 6th -> 6th
  });

  it('vendorTodayString uses PKT, not UTC (00:30 PKT is still "yesterday" in UTC)', () => {
    expect(vendorTodayString(new Date('2026-09-05T19:30:00.000Z'))).toBe('2026-09-06');
  });
});
