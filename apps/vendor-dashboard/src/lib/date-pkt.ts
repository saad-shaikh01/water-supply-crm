/**
 * Pakistan-time (Asia/Karachi, UTC+5, no DST) calendar-date helpers.
 *
 * All values are plain `YYYY-MM-DD` strings. "Today" is resolved in PKT so that
 * between 00:00 and 05:00 PKT it is NOT still yesterday's UTC date, and all
 * day/week/month arithmetic is done on the parsed parts through `Date.UTC`, so
 * it can never drift with the browser's local timezone or DST rules.
 */

export const PKT_TIME_ZONE = 'Asia/Karachi';

export interface YmdRange {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parses `YYYY-MM-DD` into 1-based month parts. */
export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Today's calendar date in Asia/Karachi as `YYYY-MM-DD`. `now` is injectable for tests. */
export function pktToday(now: Date = new Date()): string {
  // 'en-CA' formats as YYYY-MM-DD.
  return now.toLocaleDateString('en-CA', { timeZone: PKT_TIME_ZONE });
}

/** Adds (or subtracts) whole days. */
export function addDaysYmd(ymd: string, days: number): string {
  const { year, month, day } = parseYmd(ymd);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Last day of the month containing `ymd`. */
export function endOfMonthYmd(ymd: string): string {
  const { year, month } = parseYmd(ymd);
  // Day 0 of the next month is the last day of this one.
  const d = new Date(Date.UTC(year, month, 0));
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** First day of the month containing `ymd`. */
export function startOfMonthYmd(ymd: string): string {
  const { year, month } = parseYmd(ymd);
  return formatYmd(year, month, 1);
}

/** Adds (or subtracts) whole months, clamping the day to the target month's length (31 May - 3 months = 28/29 Feb). */
export function addMonthsYmd(ymd: string, months: number): string {
  const { year, month, day } = parseYmd(ymd);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatYmd(y, m, Math.min(day, lastDay));
}

/** Monday of the week containing `ymd` (Monday-start weeks). */
export function startOfWeekYmd(ymd: string): string {
  const { year, month, day } = parseYmd(ymd);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

// ── Range presets (all PKT-based) ────────────────────────────────────────────

export const rangeToday = (now?: Date): YmdRange => {
  const t = pktToday(now);
  return { from: t, to: t };
};

export const rangeYesterday = (now?: Date): YmdRange => {
  const y = addDaysYmd(pktToday(now), -1);
  return { from: y, to: y };
};

export const rangeThisWeek = (now?: Date): YmdRange => {
  const t = pktToday(now);
  return { from: startOfWeekYmd(t), to: t };
};

export const rangeThisMonth = (now?: Date): YmdRange => {
  const t = pktToday(now);
  return { from: startOfMonthYmd(t), to: t };
};

export const rangeLastMonth = (now?: Date): YmdRange => {
  const first = addMonthsYmd(startOfMonthYmd(pktToday(now)), -1);
  return { from: first, to: endOfMonthYmd(first) };
};

export const rangeLast3Months = (now?: Date): YmdRange => {
  const t = pktToday(now);
  return { from: addMonthsYmd(t, -3), to: t };
};

export const rangeThisYear = (now?: Date): YmdRange => {
  const t = pktToday(now);
  return { from: formatYmd(parseYmd(t).year, 1, 1), to: t };
};

/** `YYYY-MM-DD` -> "12 Sep" style label, timezone-independent. */
export function formatYmdShort(ymd: string): string {
  if (!ymd) return '';
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
