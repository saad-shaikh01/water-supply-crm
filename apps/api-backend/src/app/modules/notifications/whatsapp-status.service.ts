import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { extractStatuses, MetaMessageStatus } from './whatsapp-webhook.util';

/**
 * Applies Meta's delivery reports (webhook) to the NotificationLog row of the message they describe.
 *
 * "SENT" on a log row only means Meta accepted the message. These reports say what happened next:
 * delivered to the phone, read, or failed afterwards (number not on WhatsApp, user blocked the business, …).
 * Reports can arrive out of order or twice, so a row only ever moves forward: (none) → DELIVERED → READ.
 */
@Injectable()
export class WhatsAppStatusService {
  private readonly logger = new Logger(WhatsAppStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns how many reports matched a log row (the rest are for messages sent outside the notification queue). */
  async handle(body: unknown): Promise<number> {
    let matched = 0;
    for (const status of extractStatuses(body)) {
      if (await this.apply(status)) matched++;
    }
    return matched;
  }

  private async apply(s: MetaMessageStatus): Promise<boolean> {
    if (s.status !== 'delivered' && s.status !== 'read' && s.status !== 'failed') return false; // 'sent' — already known

    const row = await this.prisma.notificationLog.findFirst({
      where: { waMessageId: s.id },
      select: { id: true, deliveryStatus: true, deliveredAt: true, errorCode: true },
    });
    if (!row) return false;

    const at = s.timestamp && !Number.isNaN(Number(s.timestamp)) ? new Date(Number(s.timestamp) * 1000) : new Date();

    if (s.status === 'delivered') {
      if (row.deliveryStatus === 'DELIVERED' || row.deliveryStatus === 'READ') return true;
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: { deliveryStatus: 'DELIVERED', deliveredAt: at, deliveryError: null },
      });
      return true;
    }

    if (s.status === 'read') {
      if (row.deliveryStatus === 'READ') return true;
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: { deliveryStatus: 'READ', readAt: at, deliveredAt: row.deliveredAt ?? at, deliveryError: null },
      });
      return true;
    }

    // failed — never overrides a message the phone already confirmed.
    if (row.deliveryStatus === 'DELIVERED' || row.deliveryStatus === 'READ') return true;
    const err = s.errors?.[0];
    const detail = [err?.title ?? err?.message, err?.error_data?.details].filter(Boolean).join(' — ') || 'WhatsApp could not deliver this message';
    await this.prisma.notificationLog.update({
      where: { id: row.id },
      data: {
        deliveryStatus: 'FAILED',
        deliveryError: `${detail}${err?.code ? ` [${err.code}]` : ''}`.slice(0, 500),
        errorCode: row.errorCode ?? (err?.code ? String(err.code) : null),
      },
    });
    this.logger.warn(`WhatsApp reported delivery failure for ${s.id}: ${detail}${err?.code ? ` [${err.code}]` : ''}`);
    return true;
  }
}
