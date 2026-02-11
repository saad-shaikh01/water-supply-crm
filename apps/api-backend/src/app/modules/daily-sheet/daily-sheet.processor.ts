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

  async process(job: Job<GenerateSheetsJobData>): Promise<{ sheetIds: string[] }> {
    const { vendorId, date } = job.data;
    this.logger.log(`Processing sheet generation job ${job.id} for vendor ${vendorId}, date ${date}`);

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

    const routes = await this.prisma.route.findMany({
      where: { vendorId },
      include: {
        customers: {
          where: { deliveryDays: { has: dayOfWeek } },
        },
      },
    });

    const generatedSheetIds: string[] = [];
    const totalRoutes = routes.filter((r) => r.customers.length > 0).length;
    let processed = 0;

    for (const route of routes) {
      if (route.customers.length === 0) continue;

      const van = await this.prisma.van.findFirst({
        where: { vendorId },
        include: { defaultDriver: true },
      });

      if (!van || !van.defaultDriverId) continue;

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

      const sheet = await this.prisma.dailySheet.create({
        data: {
          vendorId,
          routeId: route.id,
          vanId: van.id,
          driverId: van.defaultDriverId,
          date: targetDate,
          items: {
            create: route.customers.map((customer, index) => ({
              customerId: customer.id,
              sequence: index + 1,
              productId: defaultProduct.id,
            })),
          },
        },
      });

      generatedSheetIds.push(sheet.id);
      processed++;
      await job.updateProgress(Math.round((processed / totalRoutes) * 100));
    }

    this.logger.log(`Job ${job.id} completed: ${generatedSheetIds.length} sheets created`);
    return { sheetIds: generatedSheetIds };
  }
}
