import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { NotificationSettingsService } from './notification-settings.service';

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
    meta?: { entityType?: string; entityId?: string; vendorId?: string; type?: NotificationType },
  ) {
    if (!(await this.allowed(meta, NotificationChannel.WHATSAPP))) return null;

    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP,
      { phoneNumber, message, ...meta },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
    );
  }

  async queueWhatsAppPdf(
    phoneNumber: string,
    receiptData: Record<string, unknown>,
    meta?: { entityType?: string; entityId?: string; vendorId?: string; type?: NotificationType },
  ) {
    if (!(await this.allowed(meta, NotificationChannel.WHATSAPP))) return null;

    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP_PDF,
      { phoneNumber, receiptData, ...meta },
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
