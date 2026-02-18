import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { DeliveryStatus, TransactionType } from '@prisma/client';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { LoadOutDto } from './dto/load-out.dto';
import { CheckInDto } from './dto/check-in.dto';
import { SwapDriverDto } from './dto/swap-driver.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class DailySheetService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private fcm: FcmService,
    @InjectQueue(QUEUE_NAMES.DAILY_SHEET_GENERATION)
    private sheetQueue: Queue,
  ) {}

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
    return {
      jobId: job.id,
      status: state,
      progress: job.progress,
      result: state === 'completed' ? job.returnvalue : undefined,
      failedReason: state === 'failed' ? job.failedReason : undefined,
    };
  }

  async submitDelivery(vendorId: string, itemId: string, dto: SubmitDeliveryDto) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        customer: { include: { customPrices: true } },
        product: true,
        dailySheet: true,
      },
    });

    if (!item || item.dailySheet.vendorId !== vendorId) {
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

      if (
        dto.status === DeliveryStatus.COMPLETED ||
        dto.status === DeliveryStatus.EMPTY_ONLY
      ) {
        const customPrice = item.customer.customPrices.find(
          (p) => p.productId === item.productId,
        );
        const price = customPrice
          ? customPrice.customPrice
          : item.product.basePrice;

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

      if (dto.status !== 'PENDING') {
        await this.audit.log({
          vendorId,
          action: 'DELIVERY_SUBMIT',
          entity: 'DailySheetItem',
          entityId: itemId,
          changes: { after: { status: dto.status, filledDropped: dto.filledDropped, emptyReceived: dto.emptyReceived } },
        });
      }

      // FCM: notify customer on completed delivery (fire-and-forget)
      if (dto.status === DeliveryStatus.COMPLETED || dto.status === DeliveryStatus.EMPTY_ONLY) {
        this.fcm.sendToCustomer(
          item.customerId,
          'Delivery Completed',
          `${dto.filledDropped} bottle(s) delivered. Empty received: ${dto.emptyReceived}.`,
          { type: 'DELIVERY', itemId },
        ).catch(() => null);
      }

      return updatedItem;
    });
  }

  async findAllPaginated(vendorId: string, query: DailySheetQueryDto) {
    const { page = 1, limit = 20, date, dateFrom, dateTo, routeId, driverId, vanId, isClosed, sortDir = 'desc' } = query;

    const where: any = { vendorId };

    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      where.date = { gte: d, lt: next };
    } else {
      if (dateFrom) where.date = { ...where.date, gte: new Date(dateFrom) };
      if (dateTo) where.date = { ...where.date, lte: new Date(dateTo) };
    }

    if (routeId) where.routeId = routeId;
    if (driverId) where.driverId = driverId;
    if (vanId) where.vanId = vanId;
    if (isClosed !== undefined) where.isClosed = isClosed;

    const [data, total] = await Promise.all([
      this.prisma.dailySheet.findMany({
        where,
        include: {
          route: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          driver: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { date: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dailySheet.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id, vendorId },
      include: {
        route: true,
        van: true,
        driver: true,
        items: {
          include: {
            customer: {
              select: {
                id: true, name: true, customerCode: true,
                address: true, phoneNumber: true,
                paymentType: true, financialBalance: true,
              },
            },
            product: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    return sheet;
  }

  async loadOut(vendorId: string, sheetId: string, dto: LoadOutDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    if (sheet.isClosed) {
      throw new ConflictException('Cannot update a closed sheet');
    }

    const updated = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: { filledOutCount: dto.filledOutCount },
    });

    // Record LOAD_OUT transaction
    await this.prisma.transaction.create({
      data: {
        type: TransactionType.LOAD_OUT,
        vendorId,
        dailySheetId: sheetId,
        bottleCount: dto.filledOutCount,
        description: `Load-out: ${dto.filledOutCount} filled bottles dispatched`,
      },
    });

    return updated;
  }

  async checkIn(vendorId: string, sheetId: string, dto: CheckInDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    if (sheet.isClosed) {
      throw new ConflictException('Cannot update a closed sheet');
    }

    const updated = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: {
        filledInCount: dto.filledInCount,
        emptyInCount: dto.emptyInCount,
        cashCollected: dto.cashCollected,
      },
    });

    // Record CHECK_IN transaction
    await this.prisma.transaction.create({
      data: {
        type: TransactionType.CHECK_IN,
        vendorId,
        dailySheetId: sheetId,
        bottleCount: dto.filledInCount + dto.emptyInCount,
        amount: dto.cashCollected,
        description: `Check-in: ${dto.filledInCount} filled, ${dto.emptyInCount} empty returned. Cash: ${dto.cashCollected}`,
      },
    });

    return updated;
  }

  async closeSheet(vendorId: string, sheetId: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      include: {
        items: true,
      },
    });
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    if (sheet.isClosed) {
      throw new ConflictException('Sheet is already closed');
    }

    const pendingItems = sheet.items.filter(
      (item) => item.status === DeliveryStatus.PENDING,
    );
    if (pendingItems.length > 0) {
      throw new BadRequestException(
        `Cannot close sheet: ${pendingItems.length} item(s) are still PENDING`,
      );
    }

    // Calculate reconciliation
    const totalDelivered = sheet.items
      .filter((i) => i.status === DeliveryStatus.COMPLETED)
      .reduce((sum, i) => sum + i.filledDropped, 0);

    const totalCashFromDeliveries = sheet.items.reduce(
      (sum, i) => sum + i.cashCollected,
      0,
    );

    const bottlesAccountedFor = sheet.filledInCount + totalDelivered;
    const bottleDiscrepancy = sheet.filledOutCount - bottlesAccountedFor;
    const cashDiscrepancy = totalCashFromDeliveries - sheet.cashCollected;

    const closed = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: {
        isClosed: true,
        cashExpected: totalCashFromDeliveries,
      },
    });

    await this.audit.log({
      vendorId,
      action: 'CLOSE',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: { after: { bottleDiscrepancy, cashDiscrepancy } },
    });

    return {
      sheet: closed,
      reconciliation: {
        filledOutCount: sheet.filledOutCount,
        totalDelivered,
        filledInCount: sheet.filledInCount,
        bottleDiscrepancy,
        cashExpected: totalCashFromDeliveries,
        cashCollected: sheet.cashCollected,
        cashDiscrepancy,
      },
    };
  }

  async swapAssignment(vendorId: string, sheetId: string, dto: SwapDriverDto) {
    if (!dto.driverId && !dto.vanId) {
      throw new UnprocessableEntityException(
        'Provide at least one of: driverId, vanId',
      );
    }

    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Cannot update a closed sheet');

    const updateData: any = {};

    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({
        where: { id: dto.vanId, vendorId },
        include: { defaultDriver: true },
      });
      if (!van) throw new NotFoundException('Van not found');
      updateData.vanId = dto.vanId;

      // If only van is changing (no explicit driver given), auto-assign van's default driver
      if (!dto.driverId && van.defaultDriverId) {
        updateData.driverId = van.defaultDriverId;
      }
    }

    if (dto.driverId) {
      const driver = await this.prisma.user.findFirst({
        where: { id: dto.driverId, vendorId },
      });
      if (!driver) throw new NotFoundException('Driver not found');
      updateData.driverId = dto.driverId;
    }

    const updated = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: updateData,
      include: {
        driver: { select: { id: true, name: true } },
        van: { select: { id: true, plateNumber: true } },
        route: { select: { id: true, name: true } },
      },
    });

    await this.audit.log({
      vendorId,
      action: 'SWAP_ASSIGNMENT',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: { after: updateData },
    });

    return updated;
  }

  async getSheetsByDriver(vendorId: string, driverId: string, date?: string) {
    const where: any = { vendorId, driverId };

    if (date) {
      const d = new Date(date);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      where.date = { gte: d, lt: next };
    }

    return this.prisma.dailySheet.findMany({
      where,
      include: {
        route: { select: { id: true, name: true } },
        van: { select: { id: true, plateNumber: true } },
        _count: { select: { items: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  // Legacy method kept for backwards-compatibility
  async findAll(vendorId: string) {
    return this.prisma.dailySheet.findMany({
      where: { vendorId },
      include: {
        route: true,
        van: true,
        driver: true,
        _count: { select: { items: true } },
      },
      orderBy: { date: 'desc' },
    });
  }
}
