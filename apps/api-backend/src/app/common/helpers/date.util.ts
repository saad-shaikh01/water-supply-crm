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
