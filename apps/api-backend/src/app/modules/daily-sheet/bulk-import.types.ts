// Internal types for the bulk import pipeline.
// Not HTTP contracts — intermediate shapes used within BulkImportService
// and returned to DailySheetController.

// ── Sanitized row shapes (output of parse + sanitize step) ───────────────

export interface SanitizedSheetRow {
  itemId: string;          // Raw Column A — may be invalid UUID; resolved later
  customerCode: string;    // Column B — fallback resolution key part 1
  customerName: string;    // Column C — display only
  productName: string;     // Column D — fallback resolution key part 2
  status: string;          // Raw, uppercased — validated in validateRowFields()
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  failureCategory?: string;
  sanitizationWarnings: string[];
}

export interface SanitizedGlobalRow extends SanitizedSheetRow {
  deliveryDate: string;    // Column A in global template (YYYY-MM-DD)
  vanPlateNumber: string;  // Column B in global template
}

// ── Row-level result in Phase 1 preview responses ────────────────────────

export interface PreviewRowResult {
  rowIndex: number;
  itemId: string | null;   // Resolved UUID (null if primary + composite fallback failed)
  customerName: string;
  customerCode: string;
  productName: string;
  currentDbStatus: string; // DailySheetItem.status from DB at preview time
  importStatus: string;    // Status value from the Excel row
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  errors: string[];        // Hard errors — row is invalid, blocked from confirm
  warnings: string[];      // Soft warnings — row flagged but allowed through confirm
}

// ── Phase 1 response types ───────────────────────────────────────────────

export interface SheetImportPreviewResponse {
  sheetId: string;
  valid: PreviewRowResult[];
  invalid: PreviewRowResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
  };
}

// A row that resolved to a specific sheet via CustomerDeliverySchedule
// (customer not scheduled that day, but single van inferred from weekly schedule)
export interface AdhocPreviewRow {
  rowIndex: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  importStatus: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  warnings: string[];
}

// A row where customer has schedules on 2+ different vans — user must pick one
export interface AmbiguousPreviewRow {
  rowIndex: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  importStatus: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  warnings: string[];
  availableVans: Array<{ vanId: string; plateNumber: string }>; // options to pick from
}

export interface GlobalPreviewGroup {
  date: string;
  vanPlateNumber: string;
  sheetId: string | null;
  sheetFound: boolean;
  isClosed: boolean;
  blockReason?: string;
  valid: PreviewRowResult[];
  adhoc: AdhocPreviewRow[];   // auto-resolved ad-hoc (single van inferred)
  invalid: PreviewRowResult[];
}

export interface GlobalImportPreviewResponse {
  groups: GlobalPreviewGroup[];
  ambiguous: AmbiguousPreviewRow[]; // needs user van selection — shown in "Needs Resolution" section
  summary: {
    totalRows: number;
    validRows: number;
    adhocRows: number;
    invalidRows: number;
    blockedGroups: number;
    ambiguousRows: number;
  };
}

// ── Phase 2 response types ───────────────────────────────────────────────

export interface SheetImportConfirmResponse {
  sheetId: string;
  processed: number;
  errors: Array<{
    itemId: string;
    customerCode?: string;
    message: string;
  }>;
}

export interface GlobalConfirmGroupResult {
  sheetId: string;
  date: string;
  vanPlateNumber: string;
  success: boolean;
  processed: number;
  error?: string;
}

export interface GlobalImportConfirmResponse {
  results: GlobalConfirmGroupResult[];
  totalProcessed: number;
  failedGroups: number;
}

// ── DB fetch shape for Phase 1 preview (both paths) ──────────────────────
// Matches the Prisma select/include used in BulkImportService.

export interface SheetItemForPreview {
  id: string;
  customerId: string;
  productId: string;
  status: string;
  customer: {
    customerCode: string;
    name: string;
    isBillingExempt: boolean;
    customPrices: Array<{ productId: string; customPrice: number }>;
  };
  product: {
    name: string;
    basePrice: number;
  };
}
