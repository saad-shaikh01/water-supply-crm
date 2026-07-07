import { apiClient } from '@water-supply-crm/data-access';

export type NotificationType =
  | 'DELIVERY_RECEIPT'
  | 'MONTHLY_STATEMENT'
  | 'PAYMENT_RECEIVED'
  | 'ORDER_UPDATE'
  | 'TICKET_REPLY';

export type NotificationChannel = 'WHATSAPP' | 'PUSH';

export interface NotificationSettingRow {
  type: NotificationType;
  channels: Record<NotificationChannel, boolean>;
}

export interface UpdateNotificationSettingPayload {
  type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

export const notificationSettingsApi = {
  getMatrix: () =>
    apiClient.get<NotificationSettingRow[]>('/notification-settings'),
  update: (payload: UpdateNotificationSettingPayload) =>
    apiClient.patch('/notification-settings', payload),
};
