import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.SEND_WHATSAPP:
        this.logger.log(`[Stub] Sending WhatsApp to ${job.data.phoneNumber}: ${job.data.message}`);
        break;
      case JOB_NAMES.SEND_SMS:
        this.logger.log(`[Stub] Sending SMS to ${job.data.phoneNumber}: ${job.data.message}`);
        break;
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
    }
  }
}
