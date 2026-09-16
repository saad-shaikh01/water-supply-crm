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
