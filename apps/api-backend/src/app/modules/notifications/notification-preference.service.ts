import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { UpsertPreferenceDto } from './dto/upsert-preference.dto';

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ eventType: 'asc' }, { channel: 'asc' }],
    });
  }

  async upsertPreference(userId: string, dto: UpsertPreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_eventType_channel: {
          userId,
          eventType: dto.eventType,
          channel: dto.channel,
        },
      },
      create: {
        userId,
        eventType: dto.eventType,
        channel: dto.channel,
        enabled: dto.enabled,
      },
      update: {
        enabled: dto.enabled,
      },
    });
  }
}
