import { vendorDateString, vendorDayEnd, vendorDayStart } from '../../common/helpers/date.util';

/**
 * Accounting-period math (P4). A period is a calendar MONTH in the vendor
 * timezone (Asia/Karachi), labelled "YYYY-MM". Pure functions — no DB.
 */

const LABEL_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriodLabel(value: string): boolean {
  return LABEL_RE.test(value);
}

/** The period label ("YYYY-MM") of the vendor (PKT) calendar day a Date / ISO / YYYY-MM-DD falls in. */
export function periodLabelOf(input: Date | string): string {
  const day = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? input
    : vendorDateString(typeof input === 'string' ? new Date(input) : input);
  return day.slice(0, 7);
}

/** Label of the month containing "now" (PKT). */
export function currentPeriodLabel(now: Date = new Date()): string {
  return periodLabelOf(now);
}

/** Inclusive PKT bounds: `startDate` = first instant of the month, `endDate` = its last millisecond, plus the YYYY-MM-DD first/last day. */
export function periodBounds(label: string): { startDate: Date; endDate: Date; firstDay: string; lastDay: string } {
  if (!isPeriodLabel(label)) throw new Error(`Invalid period label: ${label}`);
  const [y, m] = label.split('-').map(Number);
  const firstDay = `${label}-01`;
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
  const lastDay = `${label}-${String(lastDayNum).padStart(2, '0')}`;
  return { startDate: vendorDayStart(firstDay), endDate: vendorDayEnd(lastDay), firstDay, lastDay };
}

export function previousPeriodLabel(label: string): string {
  const [y, m] = label.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextPeriodLabel(label: string): string {
  const [y, m] = label.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Aug 2026" style display label. */
export function periodDisplayLabel(label: string): string {
  const [y, m] = label.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-PK', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** True when the period has fully ended in the vendor timezone (today is strictly after its last day). */
export function hasPeriodEnded(label: string, now: Date = new Date()): boolean {
  return vendorDateString(now) > periodBounds(label).lastDay;
}

/**
 * The date a redirected (system / approval-time) posting should carry: today
 * (PKT day) as a date-only value at UTC midnight — the same convention every
 * other business `date` in the ledger uses (sheet dates, manual entries).
 */
export function redirectDateForToday(now: Date = new Date()): Date {
  return new Date(`${vendorDateString(now)}T00:00:00.000Z`);
}
