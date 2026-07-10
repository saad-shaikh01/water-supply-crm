import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { DailySheetService } from './daily-sheet.service';

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

  constructor(
    private prisma: PrismaService,
    private dailySheetService: DailySheetService,
  ) {
    super();
  }

  async process(job: Job): Promise<GenerationResult | void> {
    if (job.name === JOB_NAMES.AUTO_GENERATE_DAILY_SHEETS) {
      return this.runAutoGeneration();
    }
    const { vendorId, date, vanIds } = job.data as GenerateSheetsJobData;
    return this.generateForVendor(vendorId, date, vanIds, job);
  }

  /**
   * Fans out to every active vendor for "today" (PKT). Computed via pure UTC
   * math rather than local Date methods since the host container's TZ is not
   * guaranteed to be PKT.
   */
  private async runAutoGeneration(): Promise<void> {
    const pktNow = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const dateStr = pktNow.toISOString().slice(0, 10);

    const vendors = await this.prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let succeeded = 0;
    let failed = 0;
    for (const vendor of vendors) {
      try {
        await this.generateForVendor(vendor.id, dateStr);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Auto-generation failed for vendor ${vendor.id} on ${dateStr}: ${(err as Error)?.message ?? String(err)}`,
          (err as Error)?.stack,
        );
      }
    }

    this.logger.log(
      `Auto-generation for ${dateStr}: ${succeeded}/${vendors.length} vendors processed, ${failed} failed`,
    );
  }

  private async generateForVendor(vendorId: string, date: string, vanIds?: string[], job?: Job): Promise<GenerationResult> {
    this.logger.log(`Processing sheet generation for vendor ${vendorId}, date ${date}`);

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
      this.logger.error(`No active product found for vendor ${vendorId} — sheet generation aborted for date ${date}`);
      // Notify VENDOR_ADMIN users in-app
      const admins = await this.prisma.user.findMany({
        where: { vendorId, role: 'VENDOR_ADMIN', isActive: true },
        select: { id: true },
      });
      if (admins.length > 0) {
        await this.prisma.inAppNotification.createMany({
          data: admins.map((u) => ({
            userId: u.id,
            vendorId,
            type: 'SYSTEM_ALERT',
            title: 'Sheet Generation Failed',
            message: `Daily sheet for ${date} could not be generated — no active product is configured. Please add a product.`,
            entityId: null,
          })),
        });
      }
      return { sheetIds: [], skippedVans: [], insertedOnDemandCount: 0, skippedOnDemand: [] };
    }

    // Fetch active vans (optionally filtered by vanIds)
    const vanWhere = vanIds?.length
      ? { vendorId, isActive: true, id: { in: vanIds } }
      : { vendorId, isActive: true };

    const vans = await this.prisma.van.findMany({
      where: vanWhere,
      include: {
        routes: { where: { vendorId }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
        defaultCrew: {
          where: { user: { isActive: true } },
          select: { userId: true, role: true },
        },
        deliverySchedules: {
          where: {
            dayOfWeek,
            customer: { isActive: true },
          },
          select: { customerId: true, routeSequence: true },
          orderBy: [{ routeSequence: 'asc' }, { customer: { name: 'asc' } }],
        },
      },
    });

    const generatedSheetIds: string[] = [];
    const skippedVans: { id: string; plateNumber: string; reason: string }[] = [];
    const skippedOnDemand: { orderId: string; reason: string }[] = [];
    let insertedOnDemandCount = 0;
    const activeVans = vans.filter((v) => v.deliverySchedules.length > 0);
    const totalVans = activeVans.length;
    let completedVans = 0;
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

      const { sheet, eligibleOnDemandOrderIds, alreadyInsertedOnDemandOrderIds } =
        await this.dailySheetService.createSheetForVan(
          this.prisma,
          vendorId,
          van,
          targetDate,
          dayOfWeek,
          defaultProduct,
          plannedOrders,
        );

      if (eligibleOnDemandOrderIds.length > 0) {
        insertedOnDemandCount += eligibleOnDemandOrderIds.length;
        // Remove processed orders from plannedOrders to avoid double-insertion across vans
        eligibleOnDemandOrderIds.forEach((id) => {
          const idx = plannedOrders.findIndex((p) => p.id === id);
          if (idx !== -1) plannedOrders.splice(idx, 1);
        });
      }

      // Track skipped on-demand orders (already inserted or have vanId mismatch)
      alreadyInsertedOnDemandOrderIds.forEach((orderId) =>
        skippedOnDemand.push({ orderId, reason: 'already_inserted' }),
      );

      generatedSheetIds.push(sheet.id);
      processed++;
      completedVans++;
      const percent = Math.round((completedVans / Math.max(totalVans, 1)) * 100);
      if (job) await job.updateProgress({ percent, completedVans, totalVans });
    }

    // Track any remaining planned orders not assigned to any van
    for (const order of plannedOrders) {
      skippedOnDemand.push({ orderId: order.id, reason: 'no_matching_van' });
    }

    this.logger.log(
      `Job ${job?.id ?? `auto/${vendorId}`} completed: ${generatedSheetIds.length} sheets created, ` +
      `${skippedVans.length} vans skipped, ${insertedOnDemandCount} on-demand orders inserted`,
    );
    return { sheetIds: generatedSheetIds, skippedVans, insertedOnDemandCount, skippedOnDemand };
  }
}
