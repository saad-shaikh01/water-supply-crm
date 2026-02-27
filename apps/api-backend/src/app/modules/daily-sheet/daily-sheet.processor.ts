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

interface GenerationResult {
  sheetIds: string[];
  skippedVans: { id: string; plateNumber: string; reason: string }[];
  insertedOnDemandCount: number;
  skippedOnDemand: { orderId: string; reason: string }[];
}

@Processor(QUEUE_NAMES.DAILY_SHEET_GENERATION)
export class DailySheetProcessor extends WorkerHost {
  private readonly logger = new Logger(DailySheetProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<GenerateSheetsJobData>): Promise<GenerationResult> {
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
      return { sheetIds: [], skippedVans: [], insertedOnDemandCount: 0, skippedOnDemand: [] };
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
    const skippedOnDemand: { orderId: string; reason: string }[] = [];
    let insertedOnDemandCount = 0;
    const activeVans = vans.filter((v) => v.deliverySchedules.length > 0);
    let processed = 0;

    // Fetch planned on-demand orders queued for generation on target date
    const plannedOrders = await this.prisma.customerOrder.findMany({
      where: {
        vendorId,
        status: 'APPROVED',
        dispatchStatus: 'PLANNED',
        dispatchMode: 'QUEUE_FOR_GENERATION',
        targetDate: { gte: startOfDay, lte: endOfDay },
      },
    });

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

      // On-demand orders assigned to this van (or unassigned, picked up by first van in loop)
      const vanOnDemandOrders = plannedOrders.filter(
        (o) => o.dispatchVanId === van.id || o.dispatchVanId === null,
      );

      // Idempotency: skip orders already inserted into any sheet for this vendor+date
      const alreadyInsertedOrderIds = new Set<string>();
      if (vanOnDemandOrders.length > 0) {
        const existingItems = await this.prisma.dailySheetItem.findMany({
          where: {
            sourceOrderId: { in: vanOnDemandOrders.map((o) => o.id) },
            dailySheet: { vendorId, date: { gte: startOfDay, lte: endOfDay } },
          },
          select: { sourceOrderId: true },
        });
        existingItems.forEach((i) => {
          if (i.sourceOrderId) alreadyInsertedOrderIds.add(i.sourceOrderId);
        });
      }

      const eligibleOnDemandOrders = vanOnDemandOrders.filter(
        (o) => !alreadyInsertedOrderIds.has(o.id),
      );

      const baseCount = regularSchedules.length + rescheduledItems.length;
      const allItems = [
        ...regularSchedules.map((s, index) => ({
          customerId: s.customerId,
          sequence: s.routeSequence ?? index + 1,
          productId: defaultProduct.id,
          deliveryType: 'SCHEDULED' as const,
        })),
        ...rescheduledItems.map((item, index) => ({
          customerId: item.customerId,
          sequence: regularSchedules.length + index + 1,
          productId: item.productId,
          deliveryType: 'SCHEDULED' as const,
        })),
        ...eligibleOnDemandOrders.map((order, index) => ({
          customerId: order.customerId,
          productId: order.productId,
          sequence: baseCount + index + 1,
          deliveryType: 'ON_DEMAND' as const,
          sourceOrderId: order.id,
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

      // Update on-demand orders to INSERTED_IN_SHEET
      if (eligibleOnDemandOrders.length > 0) {
        await this.prisma.customerOrder.updateMany({
          where: { id: { in: eligibleOnDemandOrders.map((o) => o.id) } },
          data: { dispatchStatus: 'INSERTED_IN_SHEET', dispatchedAt: new Date() },
        });
        insertedOnDemandCount += eligibleOnDemandOrders.length;
        // Remove processed orders from plannedOrders to avoid double-insertion across vans
        eligibleOnDemandOrders.forEach((o) => {
          const idx = plannedOrders.findIndex((p) => p.id === o.id);
          if (idx !== -1) plannedOrders.splice(idx, 1);
        });
      }

      // Track skipped on-demand orders (already inserted or have vanId mismatch)
      vanOnDemandOrders
        .filter((o) => alreadyInsertedOrderIds.has(o.id))
        .forEach((o) => skippedOnDemand.push({ orderId: o.id, reason: 'already_inserted' }));

      generatedSheetIds.push(sheet.id);
      processed++;
      await job.updateProgress(Math.round((processed / Math.max(activeVans.length, 1)) * 100));
    }

    // Track any remaining planned orders not assigned to any van
    for (const order of plannedOrders) {
      skippedOnDemand.push({ orderId: order.id, reason: 'no_matching_van' });
    }

    this.logger.log(
      `Job ${job.id} completed: ${generatedSheetIds.length} sheets created, ` +
      `${skippedVans.length} vans skipped, ${insertedOnDemandCount} on-demand orders inserted`,
    );
    return { sheetIds: generatedSheetIds, skippedVans, insertedOnDemandCount, skippedOnDemand };
  }
}
