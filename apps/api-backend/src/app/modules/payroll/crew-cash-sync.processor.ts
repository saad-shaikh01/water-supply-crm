import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { CrewCashDistributionService } from './crew-cash-distribution.service';

@Processor(QUEUE_NAMES.CREW_CASH_SYNC)
export class CrewCashSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CrewCashSyncProcessor.name);

  constructor(private crewCashDistribution: CrewCashDistributionService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.SYNC_STALE_CREW_CASH) {
      await this.crewCashDistribution.syncStaleSheets();
      return;
    }
    this.logger.warn(`Unknown Crew Cash Sync job: ${job.name}`);
  }
}
