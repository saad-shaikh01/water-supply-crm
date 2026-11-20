import { apiClient } from '@water-supply-crm/data-access';

export interface WhatsAppStatus {
  enabled: boolean;
  ready: boolean;
  status: 'disabled' | 'connected' | 'disconnected';
  /** Which sender this vendor's messages leave from (own account vs the shared platform number). */
  via?: 'ACCOUNT' | 'PLATFORM' | 'NONE';
}

export type PaymentTypeFilter = 'MONTHLY' | 'CASH' | undefined;

/**
 * 'reminder' (default) · 'statement_only' — pure statement, no payment ask / threshold ·
 * 'warning' — overdue-balance warning to customers already sent a statement this cycle.
 */
export type SendKind = 'reminder' | 'statement_only' | 'warning';

export interface WarningConfig {
  warningDelayDays: number;
  warningMinBalance: number;
  autoWarningsEnabled: boolean;
}

export interface UpdateWarningConfigPayload {
  warningDelayDays?: number;
  warningMinBalance?: number;
}

export interface SendTargetedPayload {
  mode: 'single' | 'selected' | 'eligible';
  sendKind?: SendKind;
  customerIds?: string[];
  minBalance?: number;
  dryRun?: boolean;
  month?: string;
  includeStatement?: boolean;
  paymentType?: PaymentTypeFilter;
  vanId?: string;
  dayOfWeek?: number;
  excludeCustomerIds?: string[];
}

export interface PreviewPayload {
  mode?: 'single' | 'selected' | 'eligible';
  sendKind?: SendKind;
  customerIds?: string[];
  minBalance?: number;
  month?: string;
  includeStatement?: boolean;
  force?: boolean;
  paymentType?: PaymentTypeFilter;
  vanId?: string;
  dayOfWeek?: number;
}

export interface PreviewMessagePayload {
  customerId: string;
  sendKind?: SendKind;
  month?: string;
  includeStatement?: boolean;
}

/** Exactly what one customer would receive — built by the same code the real send uses. */
export interface ReminderMessagePreview {
  customerId: string;
  name: string;
  customerCode: string;
  phone: string;
  paymentType: 'MONTHLY' | 'CASH' | null;
  kind: string;
  month: string;
  templateName: string;
  params: string[];
  /** Rendered body (null when no local copy of the template exists). */
  text: string | null;
  attachment: { filename: string } | null;
  notes: string[];
}

// ── Statement download (PDF / ZIP — nothing is sent on WhatsApp, nothing is logged) ──
export interface StatementDownloadPreviewPayload {
  mode: 'single' | 'selected' | 'eligible';
  customerIds?: string[];
  month?: string;
  paymentType?: PaymentTypeFilter;
  vanId?: string;
  dayOfWeek?: number;
}

export interface StatementDownloadCustomer {
  customerId: string;
  name: string;
  customerCode: string;
  phone: string;
  balance: number;
  paymentType: string;
}

export interface StatementDownloadPreview {
  month: string;
  limit: number;
  total: number;
  overLimit: boolean;
  customers: StatementDownloadCustomer[];
  skippedInactive: StatementDownloadCustomer[];
}

export interface StatementDownloadStatus {
  jobId: string;
  state: 'running' | 'done' | 'failed';
  month: string;
  total: number;
  processed: number;
  generated: number;
  failed: Array<{ customerId: string; name: string; customerCode: string; reason: string }>;
  file?: { name: string; contentType: string } | null;
  error?: string;
}

export const balanceRemindersApi = {
  previewStatementDownload: (data: StatementDownloadPreviewPayload) =>
    apiClient.post<StatementDownloadPreview>('/balance-reminders/download-statements/preview', data),
  startStatementDownload: (data: { customerIds: string[]; month?: string }) =>
    apiClient.post<{ jobId: string; total: number; month: string }>('/balance-reminders/download-statements', data),
  getStatementDownloadStatus: (jobId: string) =>
    apiClient.get<StatementDownloadStatus>(`/balance-reminders/download-statements/${jobId}`),
  getStatementDownloadFile: (jobId: string) =>
    apiClient.get<Blob>(`/balance-reminders/download-statements/${jobId}/file`, { responseType: 'blob' }),
  previewMessage: (data: PreviewMessagePayload) =>
    apiClient.post<ReminderMessagePreview>('/balance-reminders/preview-message', data),
  previewStatementPdf: (customerId: string, month?: string) =>
    apiClient.get<Blob>('/balance-reminders/preview-statement', { params: { customerId, month }, responseType: 'blob' }),
  sendNow: (data?: Record<string, unknown>) => apiClient.post('/balance-reminders/send-now', data ?? {}),
  sendTargeted: (data: SendTargetedPayload) => apiClient.post('/balance-reminders/send-targeted', data),
  preview: (data: PreviewPayload) => apiClient.post('/balance-reminders/preview', data),
  getWhatsAppStatus: () => apiClient.get<WhatsAppStatus>('/whatsapp/status'),
  getHistory: (
    page = 1,
    limit = 10,
    filters?: { dateFrom?: string; dateTo?: string; result?: string; kind?: string },
  ) =>
    apiClient.get('/balance-reminders/history', {
      params: {
        page,
        limit,
        dateFrom: filters?.dateFrom || undefined,
        dateTo: filters?.dateTo || undefined,
        result: filters?.result || undefined,
        kind: filters?.kind || undefined,
      },
    }),
  getHistoryDetail: (id: string) => apiClient.get(`/balance-reminders/history/${id}`),
  getConfig: () => apiClient.get<WarningConfig>('/balance-reminders/config'),
  updateConfig: (data: UpdateWarningConfigPayload) => apiClient.put<WarningConfig>('/balance-reminders/config', data),
};
