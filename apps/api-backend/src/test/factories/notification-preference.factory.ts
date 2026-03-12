import { NotificationPreference } from '@prisma/client';

const defaultTimestamp = new Date('2025-01-01T00:00:00.000Z');

export function createMockNotificationPreference(
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
  return {
    id: 'notification-preference-test-001',
    userId: 'user-test-001',
    eventType: 'order.approved',
    channel: 'FCM',
    enabled: true,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}
