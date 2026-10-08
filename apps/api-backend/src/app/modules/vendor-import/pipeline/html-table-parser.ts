import { ImportError, type ParsedFile, type RawRow } from '../import.types';

/**
 * Stage 1 (variant) — headerless HTML table export (`<TR><TD>..</TD>...</TR>`, no header row),
 * the format some legacy accounting packages produce. Like the Excel/CSV parser it only reads:
 * it decodes the text, strips markup and returns raw cells under fixed column names. All
 * business rules live in the entity definition.
 *
 * Handles Windows-1252 text and numeric / named character references (customer codes are often
 * exported as `&#72;&#48;...`).
 */

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

function cellText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export interface HtmlTableFormat {
  /** Fixed names for the first N columns; further columns are ignored. */
  headers: string[];
}

export function parseHtmlTable(buffer: Buffer, format: HtmlTableFormat, opts: { maxRows: number; maxCellChars: number }): ParsedFile {
  let text: string;
  try {
    text = new TextDecoder('windows-1252').decode(buffer);
  } catch {
    text = buffer.toString('latin1');
  }
  if (!/<tr[\s>]/i.test(text)) {
    throw new ImportError('CORRUPT_FILE', 'This HTML file does not contain a table of rows.', 400);
  }

  const width = format.headers.length;
  const rows: { rowNumber: number; values: RawRow }[] = [];
  const blocks = text.split(/<TR[^>]*>/i);
  for (let i = 1; i < blocks.length; i++) {
    const cells: string[] = [];
    const re = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blocks[i])) !== null && cells.length < width) cells.push(cellText(m[1]).slice(0, opts.maxCellChars));
    if (cells.length < width || !cells[0]) continue; // not a data row
    if (rows.length >= opts.maxRows) {
      throw new ImportError('TOO_MANY_ROWS', `The file has more than ${opts.maxRows} rows. Split it into smaller files.`, 400);
    }
    const values: RawRow = {};
    format.headers.forEach((h, c) => (values[h] = cells[c] === '' ? null : cells[c]));
    rows.push({ rowNumber: i, values });
  }
  if (rows.length === 0) throw new ImportError('NO_DATA_ROWS', 'No data rows were found in this file.', 400);

  return { sheets: [], sheetName: 'HTML table', headerRowIndex: 0, headers: [...format.headers], rows };
}
