import type { RawCell } from '../import.types';

/**
 * Small, pure cell parsers shared by import definitions. They never guess: anything that is not
 * unambiguously a number returns `{ ok: false }` and the row becomes an ERROR (design doc §10,
 * "fail closed for money").
 */

export type ParseResult<T> = { ok: true; value: T | null; rounded?: boolean } | { ok: false };

const EMPTY_MARKERS = new Set(['', '-', '--', '—', 'n/a', 'na', 'nil', 'null', 'none']);

export function isEmptyCell(c: RawCell | undefined): boolean {
  if (c === null || c === undefined) return true;
  return typeof c === 'string' && EMPTY_MARKERS.has(c.trim().toLowerCase());
}

/** Text cell → trimmed string, or null when empty / a placeholder dash. */
export function parseText(c: RawCell | undefined): string | null {
  if (isEmptyCell(c)) return null;
  return String(c).trim().replace(/\s+/g, ' ');
}

function toNumber(c: RawCell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  let t = c.trim();
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true; // accounting negative: (1,200)
    t = t.slice(1, -1);
  }
  t = t
    .replace(/\b(rs|pkr)\.?/gi, '')
    .replace(/₨|\/-/g, '')
    .replace(/[,\s]/g, '');
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return negative ? -n : n;
}

/** Money: empty → null; otherwise a number rounded to 2 dp (`rounded` flags when digits were lost). */
export function parseMoney(c: RawCell | undefined): ParseResult<number> {
  if (isEmptyCell(c)) return { ok: true, value: null };
  const n = toNumber(c as RawCell);
  if (n === null) return { ok: false };
  const r = Math.round(n * 100) / 100;
  return { ok: true, value: r === 0 ? 0 : r, rounded: Math.abs(r - n) > 1e-9 };
}

/** Whole number (bottle counts): empty → null; a fraction is an error, not silently rounded. */
export function parseWholeNumber(c: RawCell | undefined): ParseResult<number> {
  if (isEmptyCell(c)) return { ok: true, value: null };
  const n = toNumber(c as RawCell);
  if (n === null || !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: n === 0 ? 0 : n };
}

/** Convert a rupee amount to integer paise so batch totals never drift (design doc R5). */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** `YYYY-MM-DD` that is a real calendar date, else null. */
export function parseIsoDate(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
