import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES } from '@water-supply-crm/queue';

interface GenerateSheetsJobData {
  vendorId: string;
  date: string;
  vanIds?: string[];
}

@Processor(QUEUE_NAMES.DAILY_SHEET_GENERATION)
export class DailySheetProcessor extends WorkerHost {
  private readonly logger = new Logger(DailySheetProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<GenerateSheetsJobData>): Promise<{ sheetIds: string[]; skippedVans: { id: string; plateNumber: string; reason: string }[] }> {
    const { vendorId, date, vanIds } = job.data;
    this.logger.log(`Processing sheet generation job ${job.id} for vendor ${vendorId}, date ${date}`);

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const defaultProduct = await this.prisma.product.findFirst({
      where: { vendorId, isActive: true },
    });
    if (!defaultProduct) {
      this.logger.warn(`No active product found for vendor ${vendorId} — aborting`);
      return { sheetIds: [], skippedVans: [] };
    }

    // Fetch active vans (optionally filtered by vanIds)
    const vanWhere = vanIds?.length
      ? { vendorId, isActive: true, id: { in: vanIds } }
      : { vendorId, isActive: true };

    const vans = await this.prisma.van.findMany({
      where: vanWhere,
      include: {
        defaultDriver: true,
        routes: { where: { vendorId }, orderBy: { createdAt: 'asc' }, take: 1 }, // van's home route — deterministic by creation order
        deliverySchedules: {
          where: {
            dayOfWeek,
            customer: { isActive: true },
          },
          include: { customer: true },
          orderBy: [{ routeSequence: 'asc' }, { customer: { name: 'asc' } }],
        },
      },
    });

    const generatedSheetIds: string[] = [];
    const skippedVans: { id: string; plateNumber: string; reason: string }[] = [];
    const activeVans = vans.filter((v) => v.deliverySchedules.length > 0);
    let processed = 0;

    for (const van of vans) {
      const schedules = van.deliverySchedules;
      if (schedules.length === 0) continue;

      if (!van.defaultDriverId) {
        this.logger.warn(`Van ${van.plateNumber} skipped — no default driver`);
        skippedVans.push({ id: van.id, plateNumber: van.plateNumber, reason: 'No default driver assigned' });
        processed++;
        continue;
      }

      // Check for existing sheet for this van today
      const existing = await this.prisma.dailySheet.findFirst({
        where: {
          vendorId,
          vanId: van.id,
          date: { gte: startOfDay, lt: endOfDay },
        },
      });

      if (existing) {
        this.logger.log(`Van ${van.plateNumber} already has a sheet for ${date} — skipping`);
        processed++;
        continue;
      }

      // Van's home route (nullable)
      const routeId = van.routes[0]?.id ?? null;

      // Fetch any RESCHEDULED items from previous sheets for customers on this van's schedule
      const customerIds = schedules.map((s) => s.customerId);
      const rescheduledItems = await this.prisma.dailySheetItem.findMany({
        where: {
          status: 'RESCHEDULED',
          customerId: { in: customerIds },
          dailySheet: { vendorId, date: { lt: targetDate } },
        },
        include: { customer: true },
      });

      // Build unique set of rescheduled customerIds to avoid duplicates
      const rescheduledCustomerIds = new Set(rescheduledItems.map((i) => i.customerId));

      // Regular scheduled customers (exclude those already covered by rescheduled)
      const regularSchedules = schedules.filter((s) => !rescheduledCustomerIds.has(s.customerId));

      const allItems = [
        ...regularSchedules.map((s, index) => ({
          customerId: s.customerId,
          sequence: s.routeSequence ?? index + 1,
          productId: defaultProduct.id,
        })),
        ...rescheduledItems.map((item, index) => ({
          customerId: item.customerId,
          sequence: regularSchedules.length + index + 1,
          productId: item.productId,
        })),
      ];

      const sheet = await this.prisma.dailySheet.create({
        data: {
          vendorId,
          routeId,
          vanId: van.id,
          driverId: van.defaultDriverId,
          date: targetDate,
          items: { create: allItems },
        },
      });

      // Mark old RESCHEDULED items as CANCELLED (moved to new sheet)
      if (rescheduledItems.length > 0) {
        await this.prisma.dailySheetItem.updateMany({
          where: { id: { in: rescheduledItems.map((i) => i.id) } },
          data: { status: 'CANCELLED' },
        });
      }

      generatedSheetIds.push(sheet.id);
      processed++;
      await job.updateProgress(Math.round((processed / Math.max(activeVans.length, 1)) * 100));
    }

    this.logger.log(`Job ${job.id} completed: ${generatedSheetIds.length} sheets created, ${skippedVans.length} vans skipped`);
    return { sheetIds: generatedSheetIds, skippedVans };
  }
}
