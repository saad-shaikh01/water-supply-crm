import type { BillingInterval } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

/** Calendar-month add in UTC, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

export function addInterval(d: Date, interval: BillingInterval): Date {
  switch (interval) {
    case 'MONTHLY':
      return addMonths(d, 1);
    case 'QUARTERLY':
      return addMonths(d, 3);
    case 'YEARLY':
      return addMonths(d, 12);
  }
}
