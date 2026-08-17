import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { TrackingSummaryService } from './tracking-summary.service';
import { TrackingCleanupService } from './tracking-cleanup.service';

@Processor(QUEUE_NAMES.TRACKING_HISTORY)
export class TrackingProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackingProcessor.name);

  constructor(
    private trackingSummary: TrackingSummaryService,
    private trackingCleanup: TrackingCleanupService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.TRACKING_DAILY_SUMMARY) {
      return this.trackingSummary.summarizeAllVendors();
    }
    if (job.name === JOB_NAMES.TRACKING_BREADCRUMB_CLEANUP) {
      return this.trackingCleanup.purgeExpiredBreadcrumbs();
    }
    this.logger.warn(`Unknown Tracking job: ${job.name}`);
  }
}
