import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { ImportExecutorService, type ImportJobData } from './import-executor.service';

/**
 * Vendor data import worker. No automatic retry (`attempts: 1`) and `maxStalledCount: 0`: the
 * executor is resumable, so recovery is an explicit, user-visible Resume — never an unattended
 * re-run of a financial write. A stalled/failed job marks the batch FAILED via `onFailed`.
 */
@Processor(QUEUE_NAMES.VENDOR_IMPORT, { concurrency: 2, maxStalledCount: 0 })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly executor: ImportExecutorService) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    if (job.name === JOB_NAMES.VENDOR_IMPORT_EXECUTE) return this.executor.run(job.data);
    if (job.name === JOB_NAMES.VENDOR_IMPORT_REVERT) return this.executor.runRevert(job.data);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ImportJobData> | undefined, err: Error) {
    if (!job?.data?.batchId) return;
    this.logger.error(`import job ${job.id} (${job.name}) failed: ${err.message}`);
    if (job.name === JOB_NAMES.VENDOR_IMPORT_EXECUTE) await this.executor.markFailed(job.data.batchId, 'WORKER_INTERRUPTED');
  }
}
