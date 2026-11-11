import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { AnnouncementDispatchService } from './announcement-dispatch.service';
import { AnnouncementService } from './announcement.service';

export const ANNOUNCEMENT_SCAN_SCHEDULER_ID = 'announcement-due-scan';
export const ANNOUNCEMENT_SCAN_EVERY_MS = 60_000;

@Processor(QUEUE_NAMES.ANNOUNCEMENTS)
export class AnnouncementProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementProcessor.name);

  constructor(
    private readonly announcements: AnnouncementService,
    private readonly dispatcher: AnnouncementDispatchService,
    @InjectQueue(QUEUE_NAMES.ANNOUNCEMENTS) private readonly queue: Queue,
  ) {
    super();
  }

  /** Idempotent scheduler registration; never lets a Redis hiccup fail app boot. */
  async onModuleInit() {
    try {
      await this.queue.upsertJobScheduler(
        ANNOUNCEMENT_SCAN_SCHEDULER_ID,
        { every: ANNOUNCEMENT_SCAN_EVERY_MS },
        { name: JOB_NAMES.ANNOUNCEMENT_DUE_SCAN, opts: { removeOnComplete: 10, removeOnFail: 10 } },
      );
    } catch (err) {
      this.logger.error(`Failed to register announcement scan: ${(err as Error)?.message}`, (err as Error)?.stack);
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.DISPATCH_ANNOUNCEMENT) {
      await this.dispatcher.dispatch(job.data.id);
    } else if (job.name === JOB_NAMES.ANNOUNCEMENT_DUE_SCAN) {
      await this.announcements.scanDue();
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    if (!job || job.name !== JOB_NAMES.DISPATCH_ANNOUNCEMENT) return;
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await this.dispatcher.markFailed(job.data.id, err?.message ?? 'dispatch failed').catch(() => undefined);
    }
  }
}
