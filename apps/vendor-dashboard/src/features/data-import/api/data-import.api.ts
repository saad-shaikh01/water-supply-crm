import { apiClient } from '@water-supply-crm/data-access';

/** Vendor Data Import — contract mirrors apps/api-backend/.../vendor-import. */

export type ImportBatchStatus =
  | 'UPLOADED'
  | 'PLANNING'
  | 'MAPPED'
  | 'QUEUED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERTED'
  | 'PARTIALLY_REVERTED';

export type ImportRowAction = 'CREATE' | 'UPDATE' | 'SKIP_EXISTING' | 'SKIP_INVALID';
export type ImportRowResult = 'PENDING' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED' | 'REVERTED' | 'REVERT_SKIPPED';

export interface PlanSummary {
  total: number;
  create: number;
  skipExisting: number;
  skipInvalid: number;
  rowsWithWarnings: number;
  /** Σ opening balance of rows to be created, in paise (integer). */
  sumOpeningBalancePaise: number;
  sumOpeningBottles: number;
  /** TRANSACTION_HISTORY only. */
  history?: HistoryPlanSummary;
}

export interface HistoryPlanSummary {
  reportingMode: ReportingMode;
  cutoverDate: string;
  dateFrom: string | null;
  dateTo: string | null;
  customersInFile: number;
  customersToImport: number;
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

export type ReportingMode = 'STATEMENT_ONLY' | 'COUNT_IN_REPORTS';

export interface HistoryOptions {
  cutoverDate: string;
  reportingMode: ReportingMode;
  productId: string | null;
  dateOrder: 'MDY' | 'DMY';
  reportsAcknowledged: boolean;
}

export interface ImportProgress {
  created: number;
  skipped: number;
  failed: number;
  pending: number;
}

export interface ImportBatchSummary {
  plan?: PlanSummary;
  progress?: ImportProgress;
  planning?: { stage: string; done: number; total: number };
  revert?: {
    state: 'RUNNING' | 'DONE';
    startedAt: string;
    reverted?: number;
    skipped?: number;
    byReason?: Record<string, number>;
  };
}

export interface ImportBatch {
  id: string;
  entity: string;
  status: ImportBatchStatus;
  sourceFileName: string;
  sourceFileSize: number;
  sheetName: string | null;
  headerRowIndex: number;
  rowCount: number;
  mapping: { columns: Record<string, string | null>; valueMaps: Record<string, Record<string, string>> } | null;
  options: (ImportOptions & Partial<HistoryOptions>) | null;
  summary: ImportBatchSummary | null;
  planHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdByName: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  revertedAt: string | null;
  updatedAt: string;
}

export interface ImportOptions {
  productId: string | null;
  balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES' | 'POSITIVE_MEANS_WE_OWE_CUSTOMER';
  balancesAsOf: string | null;
  codeStrategy: 'USE_FILE_CODES' | 'GENERATE';
  defaultPaymentType: 'CASH' | 'MONTHLY';
  areaIntoAddress: boolean;
}

export interface ImportFieldDef {
  key: string;
  label: string;
  type: 'text' | 'phone' | 'money' | 'int' | 'enum' | 'bool';
  required: boolean;
  help?: string;
  defaultValueMap?: Record<string, string>;
  enumValues?: { value: string; label: string }[];
}

export type MappingConfidence = 'profile' | 'high' | 'medium' | 'low';

export interface ColumnSuggestion {
  header: string;
  fieldKey: string | null;
  confidence: MappingConfidence | null;
}

export interface ImportWizardData {
  batch: ImportBatch;
  headers: string[];
  sampleRows: { rowNumber: number; values: Record<string, string | number | boolean | null> }[];
  suggestions: ColumnSuggestion[];
  matchedProfile: {
    id: string;
    name: string;
    isSystem: boolean;
    valueMaps: Record<string, Record<string, string>> | null;
    optionDefaults: Partial<ImportOptions> | null;
  } | null;
  fields: ImportFieldDef[];
  activeProducts: { id: string; name: string; basePrice: number }[];
  duplicateOf: { id: string; completedAt: string | null; createdByName: string | null } | null;
  /** Present on the upload response only. */
  sheets?: string[];
}

export interface ImportDetail {
  batch: ImportBatch;
  wizard: ImportWizardData | null;
}

export interface RowIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  field?: string;
  message: string;
}

export interface ImportRow {
  id: string;
  rowNumber: number;
  raw: Record<string, string | number | boolean | null>;
  normalized: {
    customerCode: string | null;
    name: string;
    phoneNumber: string;
    address: string;
    paymentType: string;
    isActive: boolean;
    rate: number | null;
    openingBalance: number;
    openingBottles: number;
  } | null;
  issues: RowIssue[] | null;
  action: ImportRowAction | null;
  result: ImportRowResult;
  resultCode: string | null;
  resultMessage: string | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface SaveMappingPayload {
  columns: Record<string, string | null>;
  valueMaps?: Record<string, Record<string, string>>;
  options?: Partial<ImportOptions> | Partial<HistoryOptions>;
  saveProfileAs?: string;
}

export interface SaveMappingResult {
  /** PLANNING = the preview is being built by a worker job (large files); MAPPED = ready now. */
  status: 'PLANNING' | 'MAPPED';
  planHash?: string;
  summary?: PlanSummary;
  options: ImportOptions | HistoryOptions;
}

/** One voucher row of a TRANSACTION_HISTORY import, as stored in ImportRow.normalized. */
export interface VoucherNormalized {
  valid: boolean;
  customerCode: string;
  voucher: string | null;
  date: string | null;
  filled: number;
  empty: number;
  charge: number;
  paid: number;
  outstandingAfter: number | null;
  bottleBalanceAfter: number | null;
}

export interface ImportEntityInfo {
  entity: string;
  label: string;
  accept: string[];
  asyncPlan: boolean;
  maxFileMb: number;
  maxRows: number;
}

export interface ExecutePayload {
  planHash: string;
  acknowledgeWarnings: boolean;
  acknowledgeDuplicateFile?: boolean;
}

export interface RowsQuery {
  page?: number;
  limit?: number;
  action?: ImportRowAction;
  severity?: 'ERROR' | 'WARNING';
  result?: ImportRowResult;
  search?: string;
}

export interface RevertPreview {
  revertible: number;
  total: number;
  blocked: { reason: string; count: number; message: string }[];
}

export interface ColumnValue {
  value: string;
  count: number;
}

export interface ImportProfile {
  id: string;
  name: string;
  isSystem: boolean;
  lastUsedAt: string | null;
}

export const dataImportApi = {
  entities: () => apiClient.get<ImportEntityInfo[]>('/imports/entities'),
  list: (params?: { page?: number; limit?: number; status?: string }) =>
    apiClient.get<Paginated<ImportBatch>>('/imports', { params }),
  get: (id: string) => apiClient.get<ImportDetail>(`/imports/${id}`),
  upload: (
    entity: string,
    file: File,
    extra?: { sheetName?: string; headerRow?: number; replaceBatchId?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (extra?.sheetName) form.append('sheetName', extra.sheetName);
    if (extra?.headerRow) form.append('headerRow', String(extra.headerRow));
    if (extra?.replaceBatchId) form.append('replaceBatchId', extra.replaceBatchId);
    return apiClient.post<ImportWizardData>(`/imports/${entity}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  saveMapping: (id: string, data: SaveMappingPayload) => apiClient.put<SaveMappingResult>(`/imports/${id}/mapping`, data),
  columnValues: (id: string, header: string) =>
    apiClient.get<ColumnValue[]>(`/imports/${id}/column-values`, { params: { header } }),
  rows: (id: string, params?: RowsQuery) => apiClient.get<Paginated<ImportRow>>(`/imports/${id}/rows`, { params }),
  execute: (id: string, data: ExecutePayload) => apiClient.post<{ batchId: string; status: string }>(`/imports/${id}/execute`, data),
  cancel: (id: string) => apiClient.post<{ cancelled: boolean }>(`/imports/${id}/cancel`),
  revertPreview: (id: string) => apiClient.post<RevertPreview>(`/imports/${id}/revert/preview`),
  revert: (id: string) => apiClient.post<{ batchId: string; revert: 'RUNNING' }>(`/imports/${id}/revert`),
  sourceUrl: (id: string) => apiClient.get<{ signedUrl: string; fileName: string }>(`/imports/${id}/source`),
  report: (id: string) => apiClient.get<Blob>(`/imports/${id}/report`, { responseType: 'blob' }),
  template: (entity: string) => apiClient.get<Blob>(`/imports/templates/${entity}`, { responseType: 'blob' }),
  profiles: (entity?: string) => apiClient.get<ImportProfile[]>('/imports/mapping-profiles', { params: { entity } }),
  deleteProfile: (id: string) => apiClient.delete(`/imports/mapping-profiles/${id}`),
};
