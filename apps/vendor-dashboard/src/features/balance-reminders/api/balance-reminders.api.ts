import { apiClient } from '@water-supply-crm/data-access';

export interface WhatsAppStatus {
  enabled: boolean;
  ready: boolean;
  status: 'disabled' | 'connected' | 'disconnected';
}

export type PaymentTypeFilter = 'MONTHLY' | 'CASH' | undefined;

export interface SendTargetedPayload {
  mode: 'single' | 'selected' | 'eligible';
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
  customerIds?: string[];
  minBalance?: number;
  month?: string;
  includeStatement?: boolean;
  paymentType?: PaymentTypeFilter;
  vanId?: string;
  dayOfWeek?: number;
}

export const balanceRemindersApi = {
  sendNow: (data?: Record<string, unknown>) => apiClient.post('/balance-reminders/send-now', data ?? {}),
  sendTargeted: (data: SendTargetedPayload) => apiClient.post('/balance-reminders/send-targeted', data),
  preview: (data: PreviewPayload) => apiClient.post('/balance-reminders/preview', data),
  getWhatsAppStatus: () => apiClient.get<WhatsAppStatus>('/whatsapp/status'),
  getHistory: (page = 1, limit = 10, filters?: { dateFrom?: string; dateTo?: string; result?: string }) =>
    apiClient.get('/balance-reminders/history', {
      params: {
        page,
        limit,
        dateFrom: filters?.dateFrom || undefined,
        dateTo: filters?.dateTo || undefined,
        result: filters?.result || undefined,
      },
    }),
  getHistoryDetail: (id: string) => apiClient.get(`/balance-reminders/history/${id}`),
};
