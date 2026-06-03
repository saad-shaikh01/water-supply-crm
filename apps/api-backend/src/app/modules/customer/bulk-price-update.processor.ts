import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

export interface BulkPriceUpdateJobData {
  vendorId: string;
  productId: string;
  customerIds: string[];
  currentPrices: Record<string, number>;
  action: {
    type: 'SET' | 'FLAT_INCREASE' | 'PERCENTAGE_INCREASE';
    value: number;
  };
}

interface BulkPriceUpdateResult {
  updatedCount: number;
}

@Processor(QUEUE_NAMES.BULK_PRICE_UPDATE)
export class BulkPriceUpdateProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkPriceUpdateProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<BulkPriceUpdateJobData>): Promise<BulkPriceUpdateResult> {
    if (job.name !== JOB_NAMES.BULK_PRICE_UPDATE) {
      return { updatedCount: 0 };
    }

    const { vendorId, productId, customerIds, currentPrices, action } = job.data;
    this.logger.log(
      `Processing bulk price update job ${job.id} for vendor ${vendorId}: ` +
      `${customerIds.length} customers, product ${productId}, action ${action.type}`,
    );

    const BATCH_SIZE = 100;
    let processed = 0;

    for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
      const batch = customerIds.slice(i, i + BATCH_SIZE);

      const upserts = batch.map((customerId) => {
        const currentPrice = currentPrices[customerId];
        let newPrice: number;
        switch (action.type) {
          case 'SET':
            newPrice = action.value;
            break;
          case 'FLAT_INCREASE':
            newPrice = currentPrice + action.value;
            break;
          case 'PERCENTAGE_INCREASE':
            newPrice = Math.round(currentPrice * (1 + action.value / 100));
            break;
        }

        return this.prisma.customerProductPrice.upsert({
          where: { customerId_productId: { customerId, productId } },
          create: { customerId, productId, customPrice: newPrice },
          update: { customPrice: newPrice },
        });
      });

      await this.prisma.$transaction(upserts);
      processed += batch.length;
      await job.updateProgress(Math.round((processed / customerIds.length) * 100));
    }

    this.logger.log(`Job ${job.id} completed: ${processed} customer prices updated`);
    return { updatedCount: customerIds.length };
  }
}
