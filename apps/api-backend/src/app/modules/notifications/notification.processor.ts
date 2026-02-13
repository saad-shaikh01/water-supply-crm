import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { FcmService } from '../fcm/fcm.service';

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly fcm: FcmService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.SEND_WHATSAPP: {
        const { phoneNumber, message } = job.data;
        const sent = await this.whatsapp.sendMessage(phoneNumber, message);
        if (sent) {
          this.logger.log(`WhatsApp sent to ${phoneNumber}`);
        } else {
          this.logger.warn(`WhatsApp not sent to ${phoneNumber} (disabled/rate-limited/not ready)`);
        }
        break;
      }
      case JOB_NAMES.SEND_SMS:
        this.logger.log(`[Stub] Sending SMS to ${job.data.phoneNumber}: ${job.data.message}`);
        break;
      case JOB_NAMES.SEND_FCM_NOTIFICATION: {
        const { userId, title, body, data } = job.data;
        const result = await this.fcm.sendToUser(userId, title, body, data);
        this.logger.log(`FCM sent to user ${userId}: ${result.sent} sent, ${result.failed} failed`);
        break;
      }
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
    }
  }
}
