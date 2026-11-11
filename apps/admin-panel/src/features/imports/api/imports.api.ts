import { apiClient, unwrap } from '../../../lib/api';

export const IMPORT_STATUSES = [
  'UPLOADED',
  'PLANNING',
  'MAPPED',
  'QUEUED',
  'EXECUTING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
  'REVERTED',
  'PARTIALLY_REVERTED',
] as const;
export const IMPORT_ENTITIES = ['CUSTOMERS_OPENING', 'TRANSACTION_HISTORY'] as const;
/** Rows in these states keep changing: the list auto-refreshes while any is present. */
export const ACTIVE_STATUSES: readonly string[] = ['QUEUED', 'EXECUTING', 'PLANNING'];

export interface ImportRow {
  id: string;
  vendorId: string;
  vendorName: string | null;
  entity: string;
  status: string;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  rowCount: number | null;
  summary: Record<string, number> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdByName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ImportDetail extends ImportRow {
  queueState: { state: string; attemptsMade: number; failedReason: string | null } | null;
}

export interface ImportsResponse {
  data: ImportRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface ImportStats {
  last7d: Record<string, number>;
  stuck: number;
}

export interface ImportsQuery {
  vendorId?: string;
  status?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const importsApi = {
  list: (params: ImportsQuery) => unwrap(apiClient.get<ImportsResponse>('/platform/imports', { params })),
  stats: () => unwrap(apiClient.get<ImportStats>('/platform/imports/stats')),
  detail: (id: string) => unwrap(apiClient.get<ImportDetail>(`/platform/imports/${id}`)),
};
