import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { BalanceReminderService } from './balance-reminder.service';

@Processor(QUEUE_NAMES.BALANCE_REMINDERS)
export class BalanceReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(BalanceReminderProcessor.name);

  constructor(private readonly reminderService: BalanceReminderService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.SEND_BALANCE_REMINDERS) {
      this.logger.warn(`Unknown job type: ${job.name}`);
      return;
    }

    const { vendorId, minBalance } = job.data;
    this.logger.log(
      `Processing balance reminders for vendor ${vendorId} (minBalance=${minBalance})`,
    );

    try {
      const result = await this.reminderService.processVendorReminders(
        vendorId,
        minBalance ?? 100,
      );
      this.logger.log(
        `Completed reminders for vendor ${vendorId}: sent=${result.sent}, skipped=${result.skipped}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to process reminders for vendor ${vendorId}: ${err}`,
      );
      throw err; // Let BullMQ handle retries
    }
  }
}
