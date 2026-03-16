import { UpsertPreferenceDto } from './dto/upsert-preference.dto';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  createMockNotificationPreference,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  PrismaMock,
} from '../../../test';

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module = await createTestModule({
      providers: [NotificationPreferenceService, createPrismaProvider(prisma)],
    });

    service = module.get(NotificationPreferenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPreferences', () => {
    it('queries preferences by userId with the live service ordering', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      await service.getPreferences('user-123');

      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
      });
    });

    it('returns the records from Prisma unchanged', async () => {
      const preferences = [
        createMockNotificationPreference({
          userId: 'user-123',
          eventType: 'delivery.completed',
          channel: 'FCM',
        }),
        createMockNotificationPreference({
          id: 'notification-preference-test-002',
          userId: 'user-123',
          eventType: 'delivery.completed',
          channel: 'WHATSAPP',
          enabled: false,
        }),
      ];
      prisma.notificationPreference.findMany.mockResolvedValue(preferences);

      await expect(service.getPreferences('user-123')).resolves.toEqual(
        preferences,
      );
    });
  });

  describe('upsertPreference', () => {
    const dto: UpsertPreferenceDto = {
      eventType: 'order.approved',
      channel: 'WHATSAPP',
      enabled: false,
    };

    it('uses the composite Prisma unique key from the current schema', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue(
        createMockNotificationPreference({
          userId: 'user-123',
          eventType: dto.eventType,
          channel: dto.channel,
          enabled: dto.enabled,
        }),
      );

      await service.upsertPreference('user-123', dto);

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_eventType_channel: {
            userId: 'user-123',
            eventType: 'order.approved',
            channel: 'WHATSAPP',
          },
        },
        create: {
          userId: 'user-123',
          eventType: 'order.approved',
          channel: 'WHATSAPP',
          enabled: false,
        },
        update: {
          enabled: false,
        },
      });
    });

    it('updates only the enabled flag on conflict', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue(
        createMockNotificationPreference({
          userId: 'user-123',
          eventType: dto.eventType,
          channel: dto.channel,
          enabled: dto.enabled,
        }),
      );

      await service.upsertPreference('user-123', dto);

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { enabled: false },
        }),
      );
      expect(prisma.notificationPreference.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            eventType: expect.anything(),
          }),
        }),
      );
    });

    it('returns the Prisma upsert result', async () => {
      const record = createMockNotificationPreference({
        userId: 'user-123',
        eventType: dto.eventType,
        channel: dto.channel,
        enabled: dto.enabled,
      });
      prisma.notificationPreference.upsert.mockResolvedValue(record);

      await expect(service.upsertPreference('user-123', dto)).resolves.toEqual(
        record,
      );
    });
  });
});
