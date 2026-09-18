/**
 * Midnight of the calendar day containing `date`, using the server process's
 * local timezone — mirrors the exact pattern already used for "today" bucketing
 * in tracking.service.ts (`todayStart.setHours(0,0,0,0)`) and daily-sheet
 * generation. Kept as a shared helper so tracking-history's day-bucketing
 * can't silently drift from that convention.
 */
export function localDayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calendar day of `date` in the vendor's operating timezone (Asia/Karachi),
 * as YYYY-MM-DD. Use this — never raw Date/setHours() "today" comparisons —
 * to decide whether a user-submitted date is "today", past, or future:
 * setHours(0,0,0,0) buckets by the SERVER PROCESS's local timezone, which in
 * production is UTC (5 hours behind Karachi). Between midnight and 5am PKT
 * the server's UTC calendar day is still "yesterday", so a user picking
 * today's date got rejected as a future date (recordPayment / recordWalkInDelivery).
 */
export function vendorDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

/** Asia/Karachi is UTC+5 year-round (Pakistan has no DST). */
const VENDOR_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day (YYYY-MM-DD, Asia/Karachi) a `from`/`to` query value refers
 * to. A bare "YYYY-MM-DD" is taken literally; a full ISO timestamp is bucketed
 * into the PKT day it falls in.
 */
function vendorDayString(input: string | Date): string {
  if (typeof input === 'string' && DATE_ONLY_RE.test(input)) return input;
  return vendorDateString(typeof input === 'string' ? new Date(input) : input);
}

/**
 * The instant at which the given vendor (PKT) calendar day BEGINS — i.e. PKT
 * midnight, expressed as a UTC `Date`. Use as the inclusive lower bound of a
 * `from` filter. Independent of the server process timezone (unlike
 * `setHours(0,0,0,0)`), so production (UTC) and a PKT dev machine agree.
 */
export function vendorDayStart(input: string | Date): Date {
  const [y, m, d] = vendorDayString(input).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - VENDOR_TZ_OFFSET_MS);
}

/** The last millisecond of the given vendor (PKT) calendar day — inclusive upper bound of a `to` filter. */
export function vendorDayEnd(input: string | Date): Date {
  return new Date(vendorDayStart(input).getTime() + DAY_MS - 1);
}

/**
 * True when `input` falls on a vendor (PKT) calendar day AFTER today. Used to
 * reject future-dated ledger-native writes (cash can't move in the future).
 * A bare YYYY-MM-DD is compared literally; a full timestamp by its PKT day.
 */
export function isFutureVendorDate(input: string | Date, now: Date = new Date()): boolean {
  return vendorDayString(input) > vendorDateString(now);
}

/** Today's calendar day in the vendor timezone, as YYYY-MM-DD. */
export function vendorTodayString(now: Date = new Date()): string {
  return vendorDateString(now);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Parses a "YYYY-MM-DD" query param into local midnight — NOT `new Date(str)`,
 * which parses as UTC midnight and would silently shift by the server's UTC
 * offset, misaligning with localDayStart()'s bucketing everywhere else here.
 */
export function parseLocalDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
