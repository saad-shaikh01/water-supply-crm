import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly whatsapp: WhatsAppService) {
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
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
    }
  }
}
