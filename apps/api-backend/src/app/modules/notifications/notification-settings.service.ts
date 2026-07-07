import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { NotificationType, NotificationChannel } from '@prisma/client';

/** Safety-net TTL; the map is also invalidated explicitly on every write. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export const NOTIFICATION_TYPES = Object.values(NotificationType);
export const NOTIFICATION_CHANNELS = Object.values(NotificationChannel);

/** `${type}:${channel}` -> enabled. Only stored overrides are present. */
type SettingsMap = Record<string, boolean>;

export interface NotificationSettingRow {
  type: NotificationType;
  channels: Record<NotificationChannel, boolean>;
}

/**
 * Vendor-level master switches for notification flows, per channel.
 *
 * A missing DB row means the flow is ENABLED (default on), so vendors only ever
 * persist the flows they have turned off. Reads are cached per vendor and the
 * cache is dropped on every write so a toggle takes effect immediately.
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  private cacheKey(vendorId: string): string {
    return `vendor:${vendorId}:notif-settings`;
  }

  private mapKey(type: NotificationType, channel: NotificationChannel): string {
    return `${type}:${channel}`;
  }

  /** Load the vendor's override map (cached). Missing keys default to enabled. */
  private async loadMap(vendorId: string): Promise<SettingsMap> {
    const cacheKey = this.cacheKey(vendorId);
    const cached = await this.cache.get<SettingsMap>(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.notificationSetting.findMany({
      where: { vendorId },
      select: { type: true, channel: true, enabled: true },
    });

    const map: SettingsMap = {};
    for (const row of rows) {
      map[this.mapKey(row.type, row.channel)] = row.enabled;
    }

    await this.cache.set(cacheKey, map, CACHE_TTL_MS);
    return map;
  }

  /** Whether a given flow+channel should be emitted for this vendor. */
  async isEnabled(
    vendorId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const map = await this.loadMap(vendorId);
    return map[this.mapKey(type, channel)] ?? true;
  }

  /** Full type × channel matrix with effective flags — for the settings UI. */
  async getMatrix(vendorId: string): Promise<NotificationSettingRow[]> {
    const map = await this.loadMap(vendorId);
    return NOTIFICATION_TYPES.map((type) => ({
      type,
      channels: NOTIFICATION_CHANNELS.reduce(
        (acc, channel) => {
          acc[channel] = map[this.mapKey(type, channel)] ?? true;
          return acc;
        },
        {} as Record<NotificationChannel, boolean>,
      ),
    }));
  }

  /** Upsert a single toggle and drop the vendor's cache. */
  async setSetting(
    vendorId: string,
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }> {
    await this.prisma.notificationSetting.upsert({
      where: { vendorId_type_channel: { vendorId, type, channel } },
      create: { vendorId, type, channel, enabled },
      update: { enabled },
    });
    await this.cache.del(this.cacheKey(vendorId));
    return { type, channel, enabled };
  }
}
