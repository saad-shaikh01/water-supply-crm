import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { WarehouseService } from './warehouse.service';

@Processor(QUEUE_NAMES.WAREHOUSE_AUTO_REFILL)
export class WarehouseProcessor extends WorkerHost {
  private readonly logger = new Logger(WarehouseProcessor.name);

  constructor(private readonly warehouse: WarehouseService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.AUTO_REFILL_EMPTY_BOTTLES) return;

    const { vendorsProcessed, bottlesRefilled } = await this.warehouse.runAutoRefillForAllVendors();
    this.logger.log(
      `Auto-refill complete: ${vendorsProcessed} vendor(s) processed, ${bottlesRefilled} bottle(s) swept from empty to filled`,
    );
  }
}
