import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
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
  /** Who queued the job — recorded on the audit entries. Absent on jobs queued before audit existed. */
  actor?: { userId: string; name: string };
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

    const { vendorId, productId, customerIds, currentPrices, action, actor } = job.data;
    this.logger.log(
      `Processing bulk price update job ${job.id} for vendor ${vendorId}: ` +
      `${customerIds.length} customers, product ${productId}, action ${action.type}`,
    );

    const product = await this.prisma.product.findFirst({
      where: { id: productId, vendorId },
      select: { name: true },
    });

    const BATCH_SIZE = 100;
    let processed = 0;

    for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
      const batch = customerIds.slice(i, i + BATCH_SIZE);

      const newPrices: Record<string, number> = {};
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
        newPrices[customerId] = newPrice;

        return this.prisma.customerProductPrice.upsert({
          where: { customerId_productId: { customerId, productId } },
          create: { customerId, productId, customPrice: newPrice },
          update: { customPrice: newPrice },
        });
      });

      await this.prisma.$transaction(upserts);
      await this.writeAudit(job, batch, newPrices, product?.name);
      processed += batch.length;
      await job.updateProgress(Math.round((processed / customerIds.length) * 100));
    }

    // One summary row per job; the per-customer rows above carry the detail.
    await this.prisma.auditLog
      .create({
        data: {
          vendorId,
          userId: actor?.userId,
          userName: actor?.name,
          action: 'BULK_PRICE_UPDATE',
          entity: 'CustomerProductPrice',
          changes: {
            after: {
              jobId: job.id,
              productId,
              productName: product?.name,
              actionType: action.type,
              actionValue: action.value,
              updatedCount: customerIds.length,
            },
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => this.logger.error('Failed to write bulk price summary audit', err));

    this.logger.log(`Job ${job.id} completed: ${processed} customer prices updated`);
    return { updatedCount: customerIds.length };
  }

  /**
   * One PRICE_SET row per customer so a customer's price history shows bulk
   * changes alongside manual ones. Best-effort: an audit failure must not fail
   * (and retry) a batch whose prices are already committed.
   */
  private async writeAudit(
    job: Job<BulkPriceUpdateJobData>,
    customerIds: string[],
    newPrices: Record<string, number>,
    productName?: string,
  ): Promise<void> {
    const { vendorId, productId, currentPrices, action, actor } = job.data;
    try {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds }, vendorId },
        select: { id: true, name: true },
      });
      const nameById = new Map(customers.map((c) => [c.id, c.name]));

      await this.prisma.auditLog.createMany({
        data: customerIds.map((customerId) => ({
          vendorId,
          userId: actor?.userId,
          userName: actor?.name,
          action: 'PRICE_SET',
          entity: 'Customer',
          entityId: customerId,
          changes: {
            before: {
              customerId,
              customerName: nameById.get(customerId),
              productId,
              productName,
              price: currentPrices[customerId],
            },
            after: {
              customerId,
              customerName: nameById.get(customerId),
              productId,
              productName,
              price: newPrices[customerId],
              wasCustom: true,
            },
            reason: `Bulk price update (${action.type} ${action.value})`,
            bulkJobId: job.id ?? null,
          } as Prisma.InputJsonValue,
        })),
      });
    } catch (err) {
      this.logger.error(`Failed to write bulk price audit rows for job ${job.id}`, err);
    }
  }
}
