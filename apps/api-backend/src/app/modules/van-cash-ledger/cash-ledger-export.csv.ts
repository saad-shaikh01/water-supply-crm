/**
 * Cash Ledger P5 — CSV export helpers. PURE: no DB, no Nest.
 *
 * Conventions (RFC 4180 + spreadsheet-safety):
 *   - a cell is quoted (and inner quotes doubled) when it contains `,` `"` CR or LF;
 *   - rows are joined with CRLF and the file ends with a CRLF;
 *   - TEXT cells that start with `= + - @ TAB CR` are prefixed with `'` so Excel /
 *     Sheets never evaluate them as a formula (CSV / formula injection);
 *   - NUMERIC cells (built with `csvMoney` / `csvInt`) are never prefixed — a
 *     negative amount must stay a number, not become the text `'-500.00`;
 *   - the file starts with a UTF-8 BOM so Excel renders Urdu and the ₨ sign.
 */

/** UTF-8 byte-order mark (U+FEFF) — makes Excel open the file as UTF-8. */
export const UTF8_BOM = '﻿';

const CRLF = '\r\n';

/** A pre-formatted numeric cell: never formula-neutralised, never quoted. */
export interface CsvNumber {
  readonly csvNumber: string;
}

/** A cell value. Strings are treated as TEXT (neutralised); numbers/`CsvNumber` as numeric. */
export type CsvValue = string | number | CsvNumber | null | undefined;

const isCsvNumber = (value: unknown): value is CsvNumber =>
  typeof value === 'object' && value !== null && typeof (value as CsvNumber).csvNumber === 'string';

/** Amount cell: plain digits, 2 decimals, `.` separator, no thousands grouping (`-1500.50`, `0.00`). */
export function csvMoney(value: number | null | undefined): CsvNumber | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  // `-0.00` would read as a negative zero in a sheet — normalise it.
  return { csvNumber: (Object.is(rounded, -0) ? 0 : rounded).toFixed(2) };
}

/** Whole-number cell (counts, days). */
export function csvInt(value: number | null | undefined): CsvNumber | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return { csvNumber: String(Math.trunc(value)) };
}

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Prefixes `'` to a TEXT cell that a spreadsheet could evaluate as a formula. */
export function neutraliseFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/** RFC-4180 quoting of an already-neutralised string. */
function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One serialised CSV cell. `null` / `undefined` / `''` -> empty. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (isCsvNumber(value)) return value.csvNumber;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return quote(neutraliseFormula(value));
}

/** Serialises a header row + data rows (BOM first, CRLF line ends, trailing CRLF). */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<CsvValue>>,
  options: { bom?: boolean } = {},
): string {
  const { bom = true } = options;
  const lines = [headers.map((header) => csvCell(header)).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `${bom ? UTF8_BOM : ''}${lines.join(CRLF)}${CRLF}`;
}

// ── PKT (Asia/Karachi, UTC+5, no DST) date / time formatting ─────────────────

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function pktIsoParts(iso: string | Date | null | undefined): string | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + PKT_OFFSET_MS).toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ, in PKT wall-clock
}

/** PKT calendar day `YYYY-MM-DD`, or `''` for a missing / invalid instant. */
export function formatPktDate(iso: string | Date | null | undefined): string {
  return pktIsoParts(iso)?.slice(0, 10) ?? '';
}

/** PKT wall-clock `YYYY-MM-DD HH:mm`, or `''` for a missing / invalid instant. */
export function formatPktDateTime(iso: string | Date | null | undefined): string {
  const parts = pktIsoParts(iso);
  return parts ? `${parts.slice(0, 10)} ${parts.slice(11, 16)}` : '';
}

// ── Response ─────────────────────────────────────────────────────────────────

/** What an export service hands the controller. `body` already starts with the BOM. */
export interface CsvExportResult {
  filename: string;
  body: string;
  /** More rows matched than the export cap — the OLDEST rows were left out. */
  truncated: boolean;
}

/** Turns arbitrary text into a safe filename fragment (`ABC-123`). Empty when nothing usable is left. */
export function sanitizeFilenamePart(text: string | null | undefined): string {
  return (text ?? '')
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Headers for a CSV download. `X-Export-Truncated` is only sent when the export was cut short. */
export function csvResponseHeaders(result: CsvExportResult): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Cache-Control': 'private, no-store',
    // A cross-origin browser client can only read these when they are exposed.
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Truncated',
  };
  if (result.truncated) headers['X-Export-Truncated'] = 'true';
  return headers;
}
