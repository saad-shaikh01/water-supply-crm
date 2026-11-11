import { Injectable, Logger } from '@nestjs/common';
import { AnnouncementAudience, AnnouncementSeverity, AnnouncementStatus, UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { InAppNotificationService } from '../notifications/in-app-notification.service';

export const ANNOUNCEMENT_NOTIFICATION_TYPE = 'PLATFORM_ANNOUNCEMENT';
export const DISPATCH_CHUNK_SIZE = 500;

const SEVERITY_PREFIX: Record<AnnouncementSeverity, string> = {
  INFO: '',
  IMPORTANT: '[Important] ',
  CRITICAL: '[Critical] ',
};

@Injectable()
export class AnnouncementDispatchService {
  private readonly logger = new Logger(AnnouncementDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inApp: InAppNotificationService,
  ) {}

  /**
   * Idempotent fan-out. Only runs for SENDING announcements. Users that already hold a
   * notification for this announcement are skipped, so a retry/resume never duplicates.
   */
  async dispatch(id: string): Promise<{ created: number; total: number } | null> {
    const a = await this.prisma.announcement.findUnique({ where: { id }, include: { vendors: true } });
    if (!a || a.status !== AnnouncementStatus.SENDING) return null;

    try {
      const vendorFilter =
        a.audience === AnnouncementAudience.SELECTED_VENDORS
          ? { in: a.vendors.map((v) => v.vendorId) }
          : { not: null };
      const recipients = await this.prisma.user.findMany({
        where: {
          role: UserRole.VENDOR_ADMIN,
          isActive: true,
          vendorId: vendorFilter,
          vendor: { isActive: true },
        },
        select: { id: true, vendorId: true },
      });

      const existing = await this.prisma.inAppNotification.findMany({
        where: { type: ANNOUNCEMENT_NOTIFICATION_TYPE, entityId: id },
        select: { userId: true },
      });
      const have = new Set(existing.map((e) => e.userId));
      const pending = recipients.filter((r) => !have.has(r.id));

      const title = `${SEVERITY_PREFIX[a.severity]}${a.title}`;
      let created = 0;
      for (let i = 0; i < pending.length; i += DISPATCH_CHUNK_SIZE) {
        const chunk = pending.slice(i, i + DISPATCH_CHUNK_SIZE);
        const res = await this.inApp.createMany(
          chunk.map((u) => ({
            userId: u.id,
            vendorId: u.vendorId ?? undefined,
            type: ANNOUNCEMENT_NOTIFICATION_TYPE,
            title,
            message: a.body,
            entityId: id,
          })),
        );
        created += res.count;
      }

      const total = have.size + created;
      await this.prisma.announcement.updateMany({
        where: { id, status: AnnouncementStatus.SENDING },
        data: { status: AnnouncementStatus.SENT, sentAt: new Date(), recipientCount: total, lastError: null },
      });
      this.logger.log(`Announcement ${id} dispatched: ${created} new, ${total} total`);
      return { created, total };
    } catch (err) {
      // Partial progress is kept; a retry/resend resumes without duplicates.
      await this.prisma.announcement.updateMany({
        where: { id, status: AnnouncementStatus.SENDING },
        data: { lastError: String((err as Error)?.message ?? err).slice(0, 500) },
      });
      throw err;
    }
  }

  /** Called when BullMQ has exhausted retries. */
  async markFailed(id: string, error: string) {
    await this.prisma.announcement.updateMany({
      where: { id, status: AnnouncementStatus.SENDING },
      data: { status: AnnouncementStatus.FAILED, lastError: error.slice(0, 500) },
    });
  }
}
