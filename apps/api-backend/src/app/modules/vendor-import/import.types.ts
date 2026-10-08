import type { ImportEntity } from '@prisma/client';

/** A cell as stored in `ImportRow.raw` — JSON-safe. Dates are ISO `YYYY-MM-DD` strings. */
export type RawCell = string | number | boolean | null;
export type RawRow = Record<string, RawCell>;

export interface ParsedRow {
  /** 1-based spreadsheet row number, shown to the user. */
  rowNumber: number;
  values: RawRow;
}

export interface ParsedFile {
  sheets: string[];
  sheetName: string;
  /** 1-based row the headers were read from. */
  headerRowIndex: number;
  headers: string[];
  rows: ParsedRow[];
}

export type FieldType = 'text' | 'phone' | 'money' | 'int' | 'enum' | 'bool';

export interface ImportFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  /** Normalised header spellings that auto-detect to this field. */
  aliases: string[];
  /** For `enum`/`bool` fields: built-in value → canonical value (lower-cased, trimmed keys). */
  defaultValueMap?: Record<string, string>;
  /** Canonical values the user may map file values to (value-mapping UI). */
  enumValues?: { value: string; label: string }[];
}

export type MappingConfidence = 'profile' | 'high' | 'medium' | 'low';

export interface ColumnSuggestion {
  header: string;
  fieldKey: string | null;
  confidence: MappingConfidence | null;
}

export interface ImportMapping {
  /** header → field key, or null to ignore the column. */
  columns: Record<string, string | null>;
  /** field key → (lower-cased file value → canonical value, or '__SKIP_ROW__'). */
  valueMaps: Record<string, Record<string, string>>;
}

export type IssueSeverity = 'ERROR' | 'WARNING';

export interface RowIssue {
  severity: IssueSeverity;
  code: string;
  field?: string;
  message: string;
  /** Structured detail for summaries (e.g. expected vs file balance); never shown raw. */
  data?: Record<string, string | number | null>;
}

export interface NormalizedRowResult<N> {
  normalized: N | null;
  issues: RowIssue[];
}

export type PlanAction = 'CREATE' | 'SKIP_EXISTING' | 'SKIP_INVALID';

export interface PlannedRow<N> {
  rowNumber: number;
  normalized: N | null;
  issues: RowIssue[];
  action: PlanAction;
  /** Idempotency key persisted on `ImportRow.dedupeKey` (history imports). */
  dedupeKey?: string | null;
}

export interface PlanSummary {
  total: number;
  create: number;
  skipExisting: number;
  skipInvalid: number;
  rowsWithWarnings: number;
  /** Σ opening balance of CREATE rows, in paise (integer) — see design doc R5. */
  sumOpeningBalancePaise: number;
  sumOpeningBottles: number;
  /** TRANSACTION_HISTORY only. */
  history?: HistoryPlanSummary;
}

export interface HistoryPlanSummary {
  reportingMode: 'STATEMENT_ONLY' | 'COUNT_IN_REPORTS';
  cutoverDate: string;
  dateFrom: string | null;
  dateTo: string | null;
  customersInFile: number;
  customersToImport: number;
  /** Customers whose whole chain was skipped (balance mismatch or a row error). */
  customersBlocked: number;
  unknownCodes: number;
  unknownCodeList: string[];
  mismatches: { code: string; expected: number | null; file: number | null; kind: 'MONEY' | 'BOTTLES' }[];
  chargeRows: number;
  paymentRows: number;
  sumChargePaise: number;
  sumPaidPaise: number;
  bottlesOut: number;
  bottlesIn: number;
  noMovement: number;
  alreadyImported: number;
  duplicateInFile: number;
  afterCutover: number;
  withoutRunningBalance: number;
  notices: string[];
}

export interface ImportEntityInfo {
  entity: ImportEntity;
  label: string;
}

/** Error with a stable machine code, surfaced to the client as `{ code, message }`. */
export class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 422 | 503 = 422,
  ) {
    super(message);
  }
}
