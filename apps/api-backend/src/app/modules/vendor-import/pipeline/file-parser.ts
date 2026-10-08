import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { IMPORT_LIMITS } from '../import.constants';
import { ImportError, type ParsedFile, type RawCell, type RawRow } from '../import.types';

/**
 * Stage 1 — FileParser. Turns an uploaded `.xlsx` / `.csv` into header + raw rows. NO business
 * rules and NO database: it only reads, trims, drops empty rows and enforces file limits.
 * Formulas are read as their cached result, never evaluated.
 */

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Convert any ExcelJS cell value to a JSON-safe scalar. */
export function cellToRaw(value: ExcelJS.CellValue | undefined): RawCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().slice(0, IMPORT_LIMITS.maxCellChars);
    return t === '' ? null : t;
  }
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('error' in v) return null; // #N/A, #REF! …
    if ('result' in v) return cellToRaw(v['result'] as ExcelJS.CellValue); // formula → cached result
    if ('richText' in v && Array.isArray(v['richText'])) {
      return cellToRaw((v['richText'] as { text: string }[]).map((r) => r.text).join(''));
    }
    if ('text' in v) return cellToRaw(v['text'] as ExcelJS.CellValue); // hyperlink
  }
  return null;
}

function isBlank(c: RawCell) {
  return c === null || c === '';
}

/** Header text, de-duplicated so two "Phone" columns stay distinguishable. */
function uniqueHeaders(raw: RawCell[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((c, i) => {
    const base = isBlank(c) ? `Column ${i + 1}` : String(c).trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function detectDelimiter(buf: Buffer): string {
  const head = buf.subarray(0, 4096).toString('utf8').split(/\r?\n/)[0] ?? '';
  const counts: [string, number][] = [',', ';', '\t'].map((d) => [d, head.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

async function loadWorkbook(buffer: Buffer, ext: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    if (ext === '.csv') {
      // Strip a UTF-8 byte-order mark so the first header is not polluted by it.
      const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
      const body = hasBom ? buffer.subarray(3) : buffer;
      // `map` identity: keep every CSV cell as text — the default converts "0300…" to 300 and
      // would silently destroy leading zeros in phone numbers and customer codes.
      await wb.csv.read(Readable.from(body), { map: (v: unknown) => v, parserOptions: { delimiter: detectDelimiter(body) } });
    } else {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    }
  } catch {
    throw new ImportError('CORRUPT_FILE', 'This file could not be read. It may be corrupt or password-protected.', 400);
  }
  return wb;
}

function rowCells(row: ExcelJS.Row, width: number): RawCell[] {
  const out: RawCell[] = [];
  for (let c = 1; c <= width; c++) out.push(cellToRaw(row.getCell(c).value));
  return out;
}

export interface ParseOptions {
  sheetName?: string;
  /** 1-based; auto-detected when omitted. */
  headerRowIndex?: number;
  /** Row cap override (transaction-history files are much larger than customer lists). */
  maxRows?: number;
}

export async function parseImportFile(buffer: Buffer, ext: string, opts: ParseOptions = {}): Promise<ParsedFile> {
  const maxRows = opts.maxRows ?? IMPORT_LIMITS.maxRows;
  const wb = await loadWorkbook(buffer, ext);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = (opts.sheetName ? wb.getWorksheet(opts.sheetName) : wb.worksheets[0]) ?? undefined;
  if (!ws) throw new ImportError('NO_DATA_ROWS', 'The selected sheet was not found.', 400);

  const width = Math.min(ws.columnCount || 0, IMPORT_LIMITS.maxColumns + 1);
  if (width === 0) throw new ImportError('NO_DATA_ROWS', 'The sheet is empty.', 400);

  // Header row: explicit, or the first of the leading rows with ≥2 non-empty text cells.
  let headerRowIndex = opts.headerRowIndex ?? 0;
  if (!headerRowIndex) {
    const scan = Math.min(ws.rowCount, IMPORT_LIMITS.headerScanRows);
    for (let r = 1; r <= scan; r++) {
      const textCells = rowCells(ws.getRow(r), width).filter((c) => typeof c === 'string' && c !== '');
      if (textCells.length >= 2) {
        headerRowIndex = r;
        break;
      }
    }
  }
  if (!headerRowIndex) {
    throw new ImportError('HEADER_NOT_FOUND', 'Could not find a header row. Tell us which row has the column names.', 400);
  }

  const headerCells = rowCells(ws.getRow(headerRowIndex), width);
  // Trim trailing empty header cells (Excel often reports phantom columns).
  let last = headerCells.length;
  while (last > 0 && isBlank(headerCells[last - 1])) last--;
  if (last > IMPORT_LIMITS.maxColumns) {
    throw new ImportError('TOO_MANY_COLUMNS', `The file has more than ${IMPORT_LIMITS.maxColumns} columns.`, 400);
  }
  const headers = uniqueHeaders(headerCells.slice(0, last));
  if (headers.length === 0) throw new ImportError('HEADER_NOT_FOUND', 'The header row is empty.', 400);

  const rows: { rowNumber: number; values: RawRow }[] = [];
  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const cells = rowCells(ws.getRow(r), headers.length);
    if (cells.every(isBlank)) continue;
    if (rows.length >= maxRows) {
      throw new ImportError('TOO_MANY_ROWS', `The file has more than ${maxRows} rows. Split it into smaller files.`, 400);
    }
    const values: RawRow = {};
    headers.forEach((h, i) => (values[h] = cells[i]));
    rows.push({ rowNumber: r, values });
  }
  if (rows.length === 0) throw new ImportError('NO_DATA_ROWS', 'No data rows were found below the header row.', 400);

  return { sheets, sheetName: ws.name, headerRowIndex, headers, rows };
}
