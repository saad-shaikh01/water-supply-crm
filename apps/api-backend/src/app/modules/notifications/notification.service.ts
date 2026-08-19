import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationLogService } from './notification-log.service';

/** When both fields are present, the send is gated by the vendor's master switch. */
interface NotificationGate {
  vendorId?: string;
  type?: NotificationType;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationQueue: Queue,
    private readonly settings: NotificationSettingsService,
    private readonly logs: NotificationLogService,
  ) {}

  /** True unless the vendor has switched this flow off on this channel. */
  private async allowed(
    gate: NotificationGate | undefined,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (!gate?.vendorId || !gate?.type) return true; // ungated caller — always send
    return this.settings.isEnabled(gate.vendorId, gate.type, channel);
  }

  async queueWhatsApp(
    phoneNumber: string,
    message: string,
    idempotencyKey?: string,
    meta?: { entityType?: string; entityId?: string; vendorId?: string; type?: NotificationType; recipientType?: string; recipientId?: string },
  ) {
    if (!(await this.allowed(meta, NotificationChannel.WHATSAPP))) {
      await this.logs.logSkipped({ channel: 'WHATSAPP', recipientAddress: phoneNumber, eventType: meta?.type, ...meta });
      return null;
    }

    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP,
      { phoneNumber, message, ...meta },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
    );
  }

  async queueWhatsAppPdf(
    phoneNumber: string,
    receiptData: Record<string, unknown>,
    meta?: { entityType?: string; entityId?: string; vendorId?: string; type?: NotificationType; recipientType?: string; recipientId?: string },
  ) {
    if (!(await this.allowed(meta, NotificationChannel.WHATSAPP))) {
      await this.logs.logSkipped({ channel: 'WHATSAPP', recipientAddress: phoneNumber, eventType: meta?.type, ...meta });
      return null;
    }

    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP_PDF,
      { phoneNumber, receiptData, ...meta },
    );
  }

  /**
   * "Unable to deliver" notice — text-only if the driver didn't attach a photo,
   * or with the photo as an image header if `data.photoKey` is set. Which Meta
   * template to use is resolved in the processor (it needs to turn the key into
   * a signed URL first, which is I/O this queueing call shouldn't do).
   */
  async queueWhatsAppDeliveryFailure(
    phoneNumber: string,
    data: { customerName: string; customerCode: string; reasonText: string; photoKey?: string | null },
    meta?: { entityType?: string; entityId?: string; vendorId?: string; type?: NotificationType; recipientType?: string; recipientId?: string },
  ) {
    if (!(await this.allowed(meta, NotificationChannel.WHATSAPP))) {
      await this.logs.logSkipped({ channel: 'WHATSAPP', recipientAddress: phoneNumber, eventType: meta?.type, ...meta });
      return null;
    }

    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP_DELIVERY_FAILURE,
      { phoneNumber, data, ...meta },
    );
  }

  async queueSMS(phoneNumber: string, message: string, idempotencyKey?: string) {
    return this.notificationQueue.add(
      JOB_NAMES.SEND_SMS,
      { phoneNumber, message },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
    );
  }

  async queueFcm(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    idempotencyKey?: string,
    gate?: NotificationGate,
  ) {
    if (!(await this.allowed(gate, NotificationChannel.PUSH))) return null;

    return this.notificationQueue.add(
      JOB_NAMES.SEND_FCM_NOTIFICATION,
      { userId, title, body, data },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
    );
  }
}
