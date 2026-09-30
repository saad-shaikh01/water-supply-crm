/**
 * Vendors operate in Asia/Karachi (UTC+5, no DST). Month/period boundaries are
 * computed at Karachi midnight so a fill logged at 01:00 PKT on the 1st lands in
 * that month regardless of the server's own timezone.
 */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

export interface PeriodRange {
  from: Date; // inclusive
  to: Date; // exclusive
}

/** "YYYY-MM" (Karachi) -> [first-of-month 00:00 PKT, first-of-next-month 00:00 PKT). */
export function monthRange(month: string): PeriodRange {
  const [y, m] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1) - PKT_OFFSET_MS),
    to: new Date(Date.UTC(y, m, 1) - PKT_OFFSET_MS),
  };
}

/** Karachi "YYYY-MM" for an instant. */
export function pktMonthKey(date: Date): string {
  return new Date(date.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 7);
}

export function currentMonthKey(now = new Date()): string {
  return pktMonthKey(now);
}

/** Last `count` month keys ending at (and including) `endMonth`, oldest first. */
export function lastMonthKeys(count: number, endMonth: string): string[] {
  const [y, m] = endMonth.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

/** dateFrom/dateTo (inclusive calendar days, "YYYY-MM-DD") -> PeriodRange at PKT midnight. */
export function dayRange(dateFrom?: string, dateTo?: string): PeriodRange | null {
  if (!dateFrom && !dateTo) return null;
  const from = dateFrom ? new Date(`${dateFrom.slice(0, 10)}T00:00:00+05:00`) : new Date(0);
  const to = dateTo
    ? new Date(new Date(`${dateTo.slice(0, 10)}T00:00:00+05:00`).getTime() + 24 * 60 * 60 * 1000)
    : new Date('9999-01-01T00:00:00Z');
  return { from, to };
}

/**
 * Real-world fuel efficiency (km/L), full-to-full method — logs must be sorted
 * by odometer ascending. See FleetDashboardService history for the rationale.
 */
export function computeFuelAvgKmPerLiter(
  logs: { odometerAtFill: number; litersFilled: number; isFullTank: boolean }[],
): number | null {
  if (logs.length < 2) return null;
  const fullIdx = logs.reduce<number[]>((acc, l, i) => (l.isFullTank ? [...acc, i] : acc), []);

  let startIdx: number;
  let endIdx: number;
  let liters: number;
  if (fullIdx.length >= 2) {
    startIdx = fullIdx[0];
    endIdx = fullIdx[fullIdx.length - 1];
    liters = logs.slice(startIdx + 1, endIdx + 1).reduce((s, l) => s + l.litersFilled, 0);
  } else {
    startIdx = 0;
    endIdx = logs.length - 1;
    liters = logs.slice(1).reduce((s, l) => s + l.litersFilled, 0);
  }
  const distance = logs[endIdx].odometerAtFill - logs[startIdx].odometerAtFill;
  if (distance <= 0 || liters <= 0) return null;
  return distance / liters;
}
