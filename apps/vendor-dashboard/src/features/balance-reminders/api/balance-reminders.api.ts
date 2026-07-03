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
  getSchedule: () => apiClient.get('/balance-reminders/schedule'),
  setSchedule: (data: Record<string, unknown>) => apiClient.post('/balance-reminders/schedule', data),
  deleteSchedule: () => apiClient.delete('/balance-reminders/schedule'),
  sendNow: (data?: Record<string, unknown>) => apiClient.post('/balance-reminders/send-now', data ?? {}),
  sendTargeted: (data: SendTargetedPayload) => apiClient.post('/balance-reminders/send-targeted', data),
  preview: (data: PreviewPayload) => apiClient.post('/balance-reminders/preview', data),
  getWhatsAppStatus: () => apiClient.get<WhatsAppStatus>('/whatsapp/status'),
  getWhatsAppQr: () => apiClient.get<{ qr: string | null }>('/whatsapp/qr'),
  logoutWhatsApp: () => apiClient.post('/whatsapp/logout', {}),
  getHistory: (page = 1, limit = 10) => apiClient.get(`/balance-reminders/history?page=${page}&limit=${limit}`),
};
