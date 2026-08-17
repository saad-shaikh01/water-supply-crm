import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

const TZ = 'Asia/Karachi';
// Summary must run before cleanup so a completed day is turned into a
// permanent DriverStop/DriverRouteSummary before its raw breadcrumbs age out.
// Spaced an hour after the daily-sheet (00:05) and fleet (00:15) nightly jobs.
const SUMMARY_CRON = '0 1 * * *';  // 01:00 — summarize yesterday's routes
const CLEANUP_CRON = '0 2 * * *';  // 02:00 — purge expired breadcrumbs

const SUMMARY_JOB_ID = 'tracking-daily-summary';
const CLEANUP_JOB_ID = 'tracking-breadcrumb-cleanup';

/**
 * Schedules the two nightly tracking-history jobs via upsertJobScheduler —
 * the house convention (never `queue.add({repeat})`, see daily-sheet.service.ts's
 * comment on why: first-write-wins on redeploy + cron-parser ignoring `utc: true`).
 */
@Injectable()
export class TrackingSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TrackingSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TRACKING_HISTORY)
    private trackingQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      await this.trackingQueue.upsertJobScheduler(
        SUMMARY_JOB_ID,
        { pattern: SUMMARY_CRON, tz: TZ },
        { name: JOB_NAMES.TRACKING_DAILY_SUMMARY, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      await this.trackingQueue.upsertJobScheduler(
        CLEANUP_JOB_ID,
        { pattern: CLEANUP_CRON, tz: TZ },
        { name: JOB_NAMES.TRACKING_BREADCRUMB_CLEANUP, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      this.logger.log(
        `Tracking history jobs scheduled: summary ${SUMMARY_CRON} ${TZ}, cleanup ${CLEANUP_CRON} ${TZ}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule tracking history jobs: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }
}
