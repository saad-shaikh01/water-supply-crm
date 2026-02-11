import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { LedgerService } from '../transaction/ledger.service';
import { DeliveryStatus } from '@prisma/client';

@Injectable()
export class DailySheetService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    @InjectQueue(QUEUE_NAMES.DAILY_SHEET_GENERATION)
    private sheetQueue: Queue,
  ) {}

  async submitDelivery(vendorId: string, itemId: string, dto: SubmitDeliveryDto) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        customer: { include: { customPrices: true } },
        product: true
      },
    });

    if (!item || item.dailySheetId === '') {
        throw new NotFoundException('Sheet item not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedItem = await tx.dailySheetItem.update({
        where: { id: itemId },
        data: {
          status: dto.status,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          reason: dto.reason,
        },
      });

      if (dto.status === DeliveryStatus.COMPLETED || dto.status === DeliveryStatus.EMPTY_ONLY) {
        const customPrice = item.customer.customPrices.find(p => p.productId === item.productId);
        const price = customPrice ? customPrice.customPrice : item.product.basePrice;

        await this.ledger.recordDelivery({
          vendorId,
          customerId: item.customerId,
          productId: item.productId,
          dailySheetId: item.dailySheetId,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          pricePerBottle: price,
        });
      }

      return updatedItem;
    });
  }

  async generate(vendorId: string, dto: GenerateSheetsDto) {
    const job = await this.sheetQueue.add(JOB_NAMES.GENERATE_SHEETS, {
      vendorId,
      date: dto.date,
    });

    return { jobId: job.id, status: 'queued' };
  }

  async getGenerationStatus(jobId: string) {
    const job = await this.sheetQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      jobId: job.id,
      status: state,
      progress,
      result: state === 'completed' ? result : undefined,
      failedReason: state === 'failed' ? failedReason : undefined,
    };
  }

  async findAll(vendorId: string) {
    return this.prisma.dailySheet.findMany({
      where: { vendorId },
      include: { route: true, van: true, driver: true, _count: { select: { items: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(vendorId: string, id: string) {
    return this.prisma.dailySheet.findUnique({
      where: { id },
      include: {
        route: true,
        van: true,
        driver: true,
        items: {
          include: { customer: true, product: true }
        }
      },
    });
  }
}
