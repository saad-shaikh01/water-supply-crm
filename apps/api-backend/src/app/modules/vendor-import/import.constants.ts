/**
 * Vendor Data Import limits. Plain constants (not architecture): rows live in the DB and the
 * executor is chunked, so raising a cap is a config change plus moving the plan stage into the
 * job (see design doc §12). Env overrides exist so support can raise one for a single deploy.
 */
const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) && +v > 0 ? +v : d);

export const IMPORT_LIMITS = {
  maxFileBytes: num(process.env['IMPORT_MAX_FILE_BYTES'], 5 * 1024 * 1024),
  maxRows: num(process.env['IMPORT_MAX_ROWS'], 5000),
  maxColumns: 60,
  maxCellChars: 500,
  /** Header auto-detection looks at this many leading rows. */
  headerScanRows: 10,
} as const;

/** Rows per executor chunk (each row is still its own transaction). */
export const IMPORT_EXEC_CHUNK = 100;

/** Retention (design doc D6): source file + raw rows kept this long after completion. */
export const IMPORT_RETENTION_DAYS = 365;
export const IMPORT_DRAFT_TTL_DAYS = 7;

export const IMPORT_QUEUE_JOB = 'import.execute';

export const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx', '.csv'] as const;
