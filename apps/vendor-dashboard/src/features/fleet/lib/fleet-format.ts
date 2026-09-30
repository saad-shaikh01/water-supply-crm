/** Shared formatting + period helpers for the Fleet screens. */

export const fmtMoney = (n: number | null | undefined): string => `₨${Math.round(n ?? 0).toLocaleString()}`;

export const fmtNum = (n: number | null | undefined, digits = 0): string =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtKm = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n).toLocaleString()} km`);

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM" of today in the user's (Karachi) local time. */
export const currentMonth = (now = new Date()): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const monthLabel = (month: string, style: 'long' | 'short' = 'long'): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-PK', { month: style, year: 'numeric' });
};

/** Calendar-day range ("YYYY-MM-DD", inclusive) covering a "YYYY-MM" month. */
export const monthToRange = (month: string): { dateFrom: string; dateTo: string } => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${pad(last)}` };
};

export const toISODate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
