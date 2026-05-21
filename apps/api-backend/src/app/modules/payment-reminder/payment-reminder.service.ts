import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

const DAILY_CRON = '0 5 * * *'; // 10 AM PKT (UTC+5)
const REPEATABLE_JOB_ID = 'payment-reminder-daily';

@Injectable()
export class PaymentReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReminderService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PAYMENT_REMINDERS) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.scheduleDaily();
  }

  async onModuleDestroy() {
    // BullMQ queues are cleaned up by the module lifecycle automatically
  }

  private async scheduleDaily() {
    const existing = await this.queue.getRepeatableJobs();
    const alreadyScheduled = existing.some((j) => j.id === REPEATABLE_JOB_ID);
    if (alreadyScheduled) return;

    await this.queue.add(
      JOB_NAMES.SEND_PAYMENT_REMINDERS,
      {},
      {
        repeat: { pattern: DAILY_CRON },
        jobId: REPEATABLE_JOB_ID,
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );
    this.logger.log(`Payment reminder daily job scheduled (${DAILY_CRON} UTC)`);
  }
}
