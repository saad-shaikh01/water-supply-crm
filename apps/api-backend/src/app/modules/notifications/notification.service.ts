import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationQueue: Queue,
  ) {}

  async queueWhatsApp(phoneNumber: string, message: string, idempotencyKey?: string) {
    return this.notificationQueue.add(
      JOB_NAMES.SEND_WHATSAPP,
      { phoneNumber, message },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
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
  ) {
    return this.notificationQueue.add(
      JOB_NAMES.SEND_FCM_NOTIFICATION,
      { userId, title, body, data },
      idempotencyKey ? { jobId: idempotencyKey } : undefined,
    );
  }
}
