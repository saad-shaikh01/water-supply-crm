import { apiClient } from '@water-supply-crm/data-access';

export type PaymentTypeFilter = 'MONTHLY' | 'CASH' | undefined;

export interface SendTargetedPayload {
  mode: 'single' | 'selected' | 'eligible';
  customerIds?: string[];
  minBalance?: number;
  dryRun?: boolean;
  month?: string;
  includeStatement?: boolean;
  paymentType?: PaymentTypeFilter;
}

export interface PreviewPayload {
  mode?: 'single' | 'selected' | 'eligible';
  customerIds?: string[];
  minBalance?: number;
  month?: string;
  includeStatement?: boolean;
  paymentType?: PaymentTypeFilter;
}

export const balanceRemindersApi = {
  getSchedule: () => apiClient.get('/balance-reminders/schedule'),
  setSchedule: (data: Record<string, unknown>) => apiClient.post('/balance-reminders/schedule', data),
  deleteSchedule: () => apiClient.delete('/balance-reminders/schedule'),
  sendNow: (data?: Record<string, unknown>) => apiClient.post('/balance-reminders/send-now', data ?? {}),
  sendTargeted: (data: SendTargetedPayload) => apiClient.post('/balance-reminders/send-targeted', data),
  preview: (data: PreviewPayload) => apiClient.post('/balance-reminders/preview', data),
};
