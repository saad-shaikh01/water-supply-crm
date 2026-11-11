import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { BillingSweepService } from './billing-sweep.service';

export const BILLING_SWEEP_SCHEDULER_ID = 'billing-daily';
export const BILLING_SWEEP_CRON = '30 1 * * *';
export const BILLING_SWEEP_TZ = 'Asia/Karachi';

@Processor(QUEUE_NAMES.BILLING)
export class BillingSweepProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BillingSweepProcessor.name);

  constructor(
    private readonly sweep: BillingSweepService,
    @InjectQueue(QUEUE_NAMES.BILLING) private readonly queue: Queue,
  ) {
    super();
  }

  /** Idempotent scheduler registration; never lets a Redis hiccup fail app boot. */
  async onModuleInit() {
    try {
      const nextJob = await this.queue.upsertJobScheduler(
        BILLING_SWEEP_SCHEDULER_ID,
        { pattern: BILLING_SWEEP_CRON, tz: BILLING_SWEEP_TZ },
        { name: JOB_NAMES.RUN_BILLING_SWEEP, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      const nextRun = nextJob ? new Date(nextJob.timestamp + (nextJob.delay ?? 0)).toISOString() : 'unknown';
      this.logger.log(`Billing sweep scheduled (${BILLING_SWEEP_CRON} ${BILLING_SWEEP_TZ}) — next run at ${nextRun}`);
    } catch (err) {
      this.logger.error(
        `Failed to schedule billing sweep: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.RUN_BILLING_SWEEP) {
      await this.sweep.runBillingSweep();
    }
  }
}
