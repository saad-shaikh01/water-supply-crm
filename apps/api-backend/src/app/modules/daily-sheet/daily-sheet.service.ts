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
import { CreateLoadDto } from './dto/create-load.dto';
import { CheckinLoadDto } from './dto/checkin-load.dto';
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
      vanIds: dto.vanIds,
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

    // Auto-detect EMPTY_ONLY: if submitted as COMPLETED with 0 filledDropped, it's an empty-only pickup
    const resolvedStatus =
      dto.status === DeliveryStatus.COMPLETED && dto.filledDropped === 0
        ? DeliveryStatus.EMPTY_ONLY
        : dto.status;

    return this.prisma.$transaction(async (tx) => {
      const updatedItem = await tx.dailySheetItem.update({
        where: { id: itemId },
        data: {
          status: resolvedStatus,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          reason: dto.reason,
          failureCategory: dto.failureCategory,
          photoUrl: dto.photoUrl,
        },
      });

      if (
        resolvedStatus === DeliveryStatus.COMPLETED ||
        resolvedStatus === DeliveryStatus.EMPTY_ONLY
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

      if (resolvedStatus !== 'PENDING') {
        await this.audit.log({
          vendorId,
          action: 'DELIVERY_SUBMIT',
          entity: 'DailySheetItem',
          entityId: itemId,
          changes: { after: { status: resolvedStatus, filledDropped: dto.filledDropped, emptyReceived: dto.emptyReceived } },
        });
      }

      // FCM: notify customer on completed delivery (fire-and-forget)
      if (resolvedStatus === DeliveryStatus.COMPLETED || resolvedStatus === DeliveryStatus.EMPTY_ONLY) {
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
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        where.date = { ...where.date, lte: endOfDay };
      }
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
                address: true, floor: true, nearbyLandmark: true,
                deliveryInstructions: true, latitude: true, longitude: true,
                phoneNumber: true, paymentType: true, financialBalance: true,
                wallets: {
                  select: { balance: true, product: { select: { name: true } } },
                },
              },
            },
            product: true,
          },
          orderBy: { sequence: 'asc' },
        },
        loads: {
          orderBy: { tripNumber: 'asc' },
        },
      },
    });
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    return sheet;
  }

  async createLoad(vendorId: string, sheetId: string, dto: CreateLoadDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Cannot update a closed sheet');

    // Only one active trip at a time
    const activeTrip = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId: sheetId, endedAt: null },
    });
    if (activeTrip) throw new ConflictException('A trip is already in progress — check in first');

    const lastLoad = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId: sheetId },
      orderBy: { tripNumber: 'desc' },
    });
    const tripNumber = (lastLoad?.tripNumber ?? 0) + 1;

    const [load] = await this.prisma.$transaction([
      this.prisma.dailySheetLoad.create({
        data: { dailySheetId: sheetId, tripNumber, loadedFilled: dto.loadedFilled },
      }),
      this.prisma.dailySheet.update({
        where: { id: sheetId },
        data: { filledOutCount: { increment: dto.loadedFilled } },
      }),
    ]);

    return load;
  }

  async checkinLoad(vendorId: string, sheetId: string, loadId: string, dto: CheckinLoadDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Sheet is already closed');

    const load = await this.prisma.dailySheetLoad.findFirst({
      where: { id: loadId, dailySheetId: sheetId },
    });
    if (!load) throw new NotFoundException('Load trip not found');
    if (load.endedAt) throw new ConflictException('Trip already checked in');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dailySheetLoad.update({
        where: { id: loadId },
        data: {
          returnedFilled: dto.returnedFilled,
          collectedEmpty: dto.collectedEmpty,
          cashHandedIn: dto.cashHandedIn,
          endedAt: new Date(),
        },
      });

      // Update sheet-level aggregates
      await tx.dailySheet.update({
        where: { id: sheetId },
        data: {
          filledInCount: { increment: dto.returnedFilled },
          emptyInCount: { increment: dto.collectedEmpty },
          cashCollected: { increment: dto.cashHandedIn },
        },
      });

      return updated;
    });
  }

  async getLoads(vendorId: string, sheetId: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');

    return this.prisma.dailySheetLoad.findMany({
      where: { dailySheetId: sheetId },
      orderBy: { tripNumber: 'asc' },
    });
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

  // ── Reconciliation helper ─────────────────────────────────────────────
  private buildReconciliation(sheet: any) {
    const activeItems = (sheet.items as any[]).filter(
      (i) => i.status === DeliveryStatus.COMPLETED || i.status === DeliveryStatus.EMPTY_ONLY,
    );

    const getPrice = (item: any): number => {
      const custom = item.customer?.customPrices?.find(
        (cp: any) => cp.productId === item.productId,
      );
      return custom?.customPrice ?? item.product?.basePrice ?? 0;
    };

    // Bottle summary
    const totalDelivered = activeItems.reduce((s, i) => s + i.filledDropped, 0);
    const bottleDiscrepancy = sheet.filledOutCount - (sheet.filledInCount + totalDelivered);

    // Cash breakdown by payment type
    const cashItems = activeItems.filter((i) => i.customer?.paymentType === 'CASH');
    const monthlyItems = activeItems.filter((i) => i.customer?.paymentType === 'MONTHLY');

    const cashBilled = cashItems.reduce(
      (s, i) => s + getPrice(i) * i.filledDropped, 0,
    );
    const cashCollectedFromCash = cashItems.reduce((s, i) => s + i.cashCollected, 0);

    const monthlyBilled = monthlyItems.reduce(
      (s, i) => s + getPrice(i) * i.filledDropped, 0,
    );

    // Driver handover — ALL cash recorded across every item
    const totalCashRecorded = (sheet.items as any[]).reduce(
      (s, i) => s + i.cashCollected, 0,
    );
    const driverDiscrepancy = totalCashRecorded - sheet.cashCollected;

    const pendingCount = (sheet.items as any[]).filter(
      (i) => i.status === DeliveryStatus.PENDING,
    ).length;

    return {
      pendingCount,
      bottles: {
        dispatched: sheet.filledOutCount,
        delivered: totalDelivered,
        returned: sheet.filledInCount,
        discrepancy: bottleDiscrepancy,
      },
      cashCustomers: {
        count: cashItems.length,
        billed: cashBilled,
        collected: cashCollectedFromCash,
        addedToBalance: cashBilled - cashCollectedFromCash,
      },
      monthlyCustomers: {
        count: monthlyItems.length,
        billedToAccounts: monthlyBilled,
      },
      driver: {
        shouldHandIn: totalCashRecorded,
        handedIn: sheet.cashCollected,
        discrepancy: driverDiscrepancy,
      },
    };
  }

  // Fetch sheet with pricing data needed for reconciliation
  private async fetchSheetForReconciliation(vendorId: string, sheetId: string) {
    return this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      include: {
        items: {
          include: {
            customer: {
              select: {
                paymentType: true,
                customPrices: { select: { productId: true, customPrice: true } },
              },
            },
            product: { select: { basePrice: true } },
          },
        },
      },
    });
  }

  async getReconciliationPreview(vendorId: string, sheetId: string) {
    const sheet = await this.fetchSheetForReconciliation(vendorId, sheetId);
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    return this.buildReconciliation(sheet);
  }

  async closeSheet(vendorId: string, sheetId: string) {
    const sheet = await this.fetchSheetForReconciliation(vendorId, sheetId);
    if (!sheet) {
      throw new NotFoundException('Daily sheet not found');
    }
    if (sheet.isClosed) {
      throw new ConflictException('Sheet is already closed');
    }

    const pendingItems = (sheet.items as any[]).filter(
      (item) => item.status === DeliveryStatus.PENDING,
    );
    if (pendingItems.length > 0) {
      throw new BadRequestException(
        `Cannot close sheet: ${pendingItems.length} item(s) are still PENDING`,
      );
    }

    const reconciliation = this.buildReconciliation(sheet);

    const closed = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: {
        isClosed: true,
        cashExpected: reconciliation.driver.shouldHandIn,
      },
    });

    await this.audit.log({
      vendorId,
      action: 'CLOSE',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: {
        after: {
          bottleDiscrepancy: reconciliation.bottles.discrepancy,
          driverCashDiscrepancy: reconciliation.driver.discrepancy,
        },
      },
    });

    return {
      sheet: closed,
      reconciliation,
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

  async getDriverStats(
    vendorId: string,
    driverId: string,
    params: { month?: string; dateFrom?: string; dateTo?: string },
  ) {
    let startDate: Date, endDate: Date;
    if (params.month) {
      const [y, m] = params.month.split('-').map(Number);
      startDate = new Date(y, m - 1, 1);
      endDate = new Date(y, m, 0, 23, 59, 59);
    } else {
      startDate = params.dateFrom ? new Date(params.dateFrom) : new Date(0);
      endDate = params.dateTo ? new Date(params.dateTo) : new Date();
    }

    const sheets = await this.prisma.dailySheet.findMany({
      where: {
        vendorId,
        driverId,
        isClosed: true,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        van: { select: { plateNumber: true } },
        route: { select: { name: true } },
        items: {
          select: {
            status: true,
            filledDropped: true,
            emptyReceived: true,
            cashCollected: true,
            failureCategory: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    let totalItems = 0;
    let deliveredCount = 0;
    let totalBottles = 0;
    let totalEmpties = 0;
    const failureBreakdown: Record<string, number> = {};

    for (const sheet of sheets) {
      for (const item of sheet.items) {
        totalItems++;
        if (item.status === 'COMPLETED' || item.status === 'EMPTY_ONLY') {
          deliveredCount++;
          totalBottles += item.filledDropped;
          totalEmpties += item.emptyReceived;
        }
        if (item.failureCategory) {
          failureBreakdown[item.failureCategory] =
            (failureBreakdown[item.failureCategory] ?? 0) + 1;
        }
      }
    }

    const cashExpected = sheets.reduce((s, sh) => s + sh.cashExpected, 0);
    const cashCollected = sheets.reduce((s, sh) => s + sh.cashCollected, 0);

    return {
      totalSheets: sheets.length,
      totalItems,
      deliveredCount,
      successRate:
        totalItems > 0 ? Math.round((deliveredCount / totalItems) * 100) : 0,
      totalBottlesDropped: totalBottles,
      totalEmptiesReceived: totalEmpties,
      cashExpected,
      cashCollected,
      cashDiscrepancy: cashExpected - cashCollected,
      failureBreakdown,
      sheets: sheets.map((s) => ({
        id: s.id,
        date: s.date,
        van: s.van.plateNumber,
        route: s.route?.name ?? null,
        totalItems: s.items.length,
        deliveredItems: s.items.filter(
          (i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY',
        ).length,
        cashCollected: s.cashCollected,
        cashExpected: s.cashExpected,
      })),
    };
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
