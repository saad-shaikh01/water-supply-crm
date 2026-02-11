import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationQueue: Queue,
  ) {}

  async queueWhatsApp(phoneNumber: string, message: string) {
    return this.notificationQueue.add(JOB_NAMES.SEND_WHATSAPP, {
      phoneNumber,
      message,
    });
  }

  async queueSMS(phoneNumber: string, message: string) {
    return this.notificationQueue.add(JOB_NAMES.SEND_SMS, {
      phoneNumber,
      message,
    });
  }
}
