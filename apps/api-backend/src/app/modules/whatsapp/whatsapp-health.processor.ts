import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { WhatsAppAccountService } from './whatsapp-account.service';

/** Daily re-verification of every stored WhatsApp sender (token still valid? quality rating?). */
@Processor(QUEUE_NAMES.WHATSAPP_HEALTH)
export class WhatsAppHealthProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppHealthProcessor.name);

  constructor(private readonly accounts: WhatsAppAccountService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.WHATSAPP_ACCOUNT_HEALTH) {
      this.logger.warn(`Unknown WhatsApp health job: ${job.name}`);
      return;
    }
    await this.accounts.runHealthCheck();
  }
}
