import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES } from '@water-supply-crm/queue';

interface GenerateSheetsJobData {
  vendorId: string;
  date: string;
}

@Processor(QUEUE_NAMES.DAILY_SHEET_GENERATION)
export class DailySheetProcessor extends WorkerHost {
  private readonly logger = new Logger(DailySheetProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<GenerateSheetsJobData>): Promise<{ sheetIds: string[]; skippedRoutes: { id: string; name: string; reason: string }[] }> {
    const { vendorId, date } = job.data;
    this.logger.log(`Processing sheet generation job ${job.id} for vendor ${vendorId}, date ${date}`);

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

    const routes = await this.prisma.route.findMany({
      where: { vendorId },
      include: {
        customers: {
          where: { deliveryDays: { has: dayOfWeek }, isActive: true },
        },
        defaultVan: {
          include: { defaultDriver: true },
        },
      },
    });

    const generatedSheetIds: string[] = [];
    const skippedRoutes: { id: string; name: string; reason: string }[] = [];
    const totalRoutes = routes.filter((r) => r.customers.length > 0).length;
    let processed = 0;

    for (const route of routes) {
      if (route.customers.length === 0) continue;

      // Each route uses its own assigned van + that van's default driver
      const van = route.defaultVan;
      if (!van || !van.isActive) {
        const reason = !van ? 'No van assigned to this route' : `Van ${van.plateNumber} is inactive (under maintenance)`;
        this.logger.warn(`Route "${route.name}" skipped — ${reason}`);
        skippedRoutes.push({ id: route.id, name: route.name, reason });
        processed++;
        continue;
      }
      if (!van.defaultDriverId) {
        this.logger.warn(`Route "${route.name}" skipped — van has no defaultDriver`);
        skippedRoutes.push({ id: route.id, name: route.name, reason: `Van ${van.plateNumber} has no default driver` });
        processed++;
        continue;
      }

      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existing = await this.prisma.dailySheet.findFirst({
        where: {
          vendorId,
          routeId: route.id,
          date: { gte: startOfDay, lt: endOfDay },
        },
      });

      if (existing) {
        processed++;
        continue;
      }

      const defaultProduct = await this.prisma.product.findFirst({
        where: { vendorId, isActive: true },
      });

      if (!defaultProduct) continue;

      // Fetch any RESCHEDULED items from previous sheets for customers on this route
      const rescheduledItems = await this.prisma.dailySheetItem.findMany({
        where: {
          status: 'RESCHEDULED',
          customer: { routeId: route.id, vendorId },
          dailySheet: { date: { lt: targetDate } },
        },
        include: { customer: true },
      });

      // Build unique set of rescheduled customerIds to avoid duplicates with regular schedule
      const rescheduledCustomerIds = new Set(rescheduledItems.map((i) => i.customerId));

      // Regular scheduled customers (exclude those already covered by rescheduled)
      const regularCustomers = route.customers.filter(
        (c) => !rescheduledCustomerIds.has(c.id),
      );

      const allItems = [
        ...regularCustomers.map((customer, index) => ({
          customerId: customer.id,
          sequence: index + 1,
          productId: defaultProduct.id,
        })),
        ...rescheduledItems.map((item, index) => ({
          customerId: item.customerId,
          sequence: regularCustomers.length + index + 1,
          productId: item.productId,
        })),
      ];

      const sheet = await this.prisma.dailySheet.create({
        data: {
          vendorId,
          routeId: route.id,
          vanId: van.id,
          driverId: van.defaultDriverId,
          date: targetDate,
          items: { create: allItems },
        },
      });

      // Mark the old RESCHEDULED items as CANCELLED (they've been moved to new sheet)
      if (rescheduledItems.length > 0) {
        await this.prisma.dailySheetItem.updateMany({
          where: { id: { in: rescheduledItems.map((i) => i.id) } },
          data: { status: 'CANCELLED' },
        });
      }

      generatedSheetIds.push(sheet.id);
      processed++;
      await job.updateProgress(Math.round((processed / totalRoutes) * 100));
    }

    this.logger.log(`Job ${job.id} completed: ${generatedSheetIds.length} sheets created, ${skippedRoutes.length} routes skipped`);
    return { sheetIds: generatedSheetIds, skippedRoutes };
  }
}
