import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { DeliveryStatus, PaymentType, TransactionType } from '@prisma/client';
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
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { NotificationService } from '../notifications/notification.service';
import { MessageTemplates } from '../whatsapp/templates/message.templates';
import { InsertOrderItemDto, SequenceMode } from './dto/insert-order-item.dto';
import { paginate } from '../../common/helpers/paginate';
import { CacheInvalidationService } from '@water-supply-crm/caching';

@Injectable()
export class DailySheetService {
  private readonly logger = new Logger(DailySheetService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private fcm: FcmService,
    private deliveryIssue: DeliveryIssueService,
    private cache: CacheInvalidationService,
    private notifications: NotificationService,
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
        customer: { select: { name: true, phoneNumber: true, isBillingExempt: true, customPrices: { select: { productId: true, customPrice: true } } } },
        product: { select: { name: true, basePrice: true } },
        dailySheet: { select: { vendorId: true, date: true } },
      },
    });

    if (!item || item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Sheet item not found');
    }

    const TERMINAL_STATUSES: string[] = ['COMPLETED', 'EMPTY_ONLY', 'NOT_AVAILABLE', 'CANCELLED'];
    if (TERMINAL_STATUSES.includes(item.status) && !dto.forceResubmit) {
      throw new ConflictException(
        `Delivery already recorded as ${item.status}. Set forceResubmit=true to override.`
      );
    }
    if (dto.forceResubmit && TERMINAL_STATUSES.includes(item.status)) {
      await this.audit.log({
        vendorId,
        action: 'DELIVERY_EDIT_OVERRIDE',
        entity: 'DailySheetItem',
        entityId: itemId,
        changes: {
          before: { status: item.status, filledDropped: item.filledDropped, emptyReceived: item.emptyReceived },
          after: { status: dto.status, filledDropped: dto.filledDropped, emptyReceived: dto.emptyReceived },
        },
      });
    }

    const activeLoad = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId: item.dailySheetId, endedAt: null },
    });
    if (!activeLoad) {
      throw new BadRequestException('No active trip. Start a trip before recording deliveries.');
    }

    // Auto-detect EMPTY_ONLY: if submitted as COMPLETED with 0 filledDropped, it's an empty-only pickup
    const resolvedStatus =
      dto.status === DeliveryStatus.COMPLETED && dto.filledDropped === 0
        ? DeliveryStatus.EMPTY_ONLY
        : dto.status;

    const customPrice = item.customer.customPrices.find(
      (p) => p.productId === item.productId,
    );
    const price = item.customer.isBillingExempt
      ? 0
      : (customPrice ? customPrice.customPrice : item.product.basePrice);

    const result = await this.prisma.$transaction(async (tx) => {
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
          pricePerBottle: price,
          ...(resolvedStatus === DeliveryStatus.COMPLETED || resolvedStatus === DeliveryStatus.EMPTY_ONLY
            ? { deliveredAt: new Date() }
            : { deliveredAt: null }),
        },
      });

      if (
        resolvedStatus === DeliveryStatus.COMPLETED ||
        resolvedStatus === DeliveryStatus.EMPTY_ONLY
      ) {
        await this.ledger.recordDelivery({
          vendorId,
          customerId: item.customerId,
          productId: item.productId,
          dailySheetId: item.dailySheetId,
          dailySheetItemId: itemId,
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
        ).catch((e: Error) => this.logger.warn(`FCM delivery-complete failed for item ${itemId}: ${e.message}`));

        // WhatsApp: only send when bottles were actually dropped (not empty-only pickups)
        if (resolvedStatus === DeliveryStatus.COMPLETED && item.customer.phoneNumber) {
          const waMsg = MessageTemplates.deliveryCompleted(
            item.customer.name,
            item.product.name,
            dto.filledDropped,
            dto.cashCollected ?? 0,
          );
          this.notifications.queueWhatsApp(item.customer.phoneNumber, waMsg)
            .catch((e: Error) => this.logger.warn(`WhatsApp delivery-complete failed for item ${itemId}: ${e.message}`));
        }
      }

      // Auto-create delivery issue for failed/rescheduled deliveries
      const failureStatuses: DeliveryStatus[] = [
        DeliveryStatus.NOT_AVAILABLE,
        DeliveryStatus.RESCHEDULED,
      ];
      if (failureStatuses.includes(resolvedStatus)) {
        this.deliveryIssue.createForItem(vendorId, itemId).catch((e: Error) =>
          this.logger.warn(`Auto-issue creation failed for item ${itemId}: ${e.message}`),
        );
      }

      // FCM: notify customer on any delivery failure (fire-and-forget)
      if (
        resolvedStatus === DeliveryStatus.NOT_AVAILABLE ||
        resolvedStatus === DeliveryStatus.RESCHEDULED ||
        resolvedStatus === DeliveryStatus.CANCELLED
      ) {
        const failureBody = dto.reason
          ? `Your delivery could not be completed. Reason: ${dto.reason}`
          : 'Your delivery could not be completed. Please contact support.';
        this.fcm
          .sendToCustomer(
            item.customerId,
            'Delivery Unsuccessful 🚫',
            failureBody,
            { type: NOTIFICATION_EVENTS.DELIVERY_FAILED, itemId },
          )
          .catch((e: Error) => this.logger.warn(`FCM delivery-failed notification failed for item ${itemId}: ${e.message}`));
      }

      return updatedItem;
    });

    const sheetDate = item.dailySheet.date.toISOString().slice(0, 10);
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, sheetDate),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);

    return result;
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

    const [sheets, total] = await Promise.all([
      this.prisma.dailySheet.findMany({
        where,
        include: {
          route: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          driver: { select: { id: true, name: true } },
          items: {
            select: {
              status: true,
              deliveryType: true,
              deliveryIssue: { select: { id: true, status: true } },
            },
          },
          loads: { select: { endedAt: true } },
        },
        orderBy: { date: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dailySheet.count({ where }),
    ]);

    const data = sheets.map(({ items, loads, ...sheet }) => {
      const issueCount = items.filter((i) => i.deliveryIssue !== null).length;
      const onDemandCount = items.filter((i) => i.deliveryType === 'ON_DEMAND').length;
      const itemCounts = {
        pending: items.filter((i) => i.status === 'PENDING').length,
        completed: items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY').length,
        issues: items.filter((i) => ['NOT_AVAILABLE', 'RESCHEDULED', 'CANCELLED'].includes(i.status)).length,
      };
      const tripState = {
        tripCount: loads.length,
        hasActiveTrip: loads.some((l) => l.endedAt === null),
      };
      return {
        ...sheet,
        _count: { items: items.length },
        itemCounts,
        tripState,
        issueCount,
        onDemandCount,
      };
    });

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
                  select: { productId: true, balance: true, product: { select: { name: true } } },
                },
                customPrices: {
                  select: { productId: true, customPrice: true },
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

    // Batch-fetch last completed filledDropped for each customer+product pair
    const itemPairs = sheet.items.map((i) => ({
      customerId: i.customerId,
      productId: i.productId,
    }));

    if (itemPairs.length > 0) {
      const lastDeliveries = await this.prisma.dailySheetItem.findMany({
        where: {
          status: { in: ['COMPLETED', 'EMPTY_ONLY'] },
          dailySheetId: { not: sheet.id },
          dailySheet: { vendorId },
          OR: itemPairs.map((p) => ({
            customerId: p.customerId,
            productId: p.productId,
          })),
        },
        orderBy: { updatedAt: 'desc' },
        distinct: ['customerId', 'productId'],
        select: { customerId: true, productId: true, filledDropped: true },
      });

      // Mutate items in-place to add lastFilledDropped (avoids TS return-type widening)
      for (const it of sheet.items as any[]) {
        const last = lastDeliveries.find(
          (ld) => ld.customerId === it.customerId && ld.productId === it.productId,
        );
        it.lastFilledDropped = last?.filledDropped ?? null;
      }
    }

    return sheet;
  }

  async insertItemFromOrder(vendorId: string, sheetId: string, dto: InsertOrderItemDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      include: { _count: { select: { items: true } } },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Cannot insert into a closed sheet');

    const order = await this.prisma.customerOrder.findUnique({ where: { id: dto.orderId } });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED orders can be inserted into a sheet');
    }

    // Idempotency: check if an item for this order already exists in this sheet
    const existing = await this.prisma.dailySheetItem.findFirst({
      where: { dailySheetId: sheetId, sourceOrderId: dto.orderId },
    });
    if (existing) return existing;

    const sequence =
      dto.sequenceMode === SequenceMode.CUSTOM && dto.sequence
        ? dto.sequence
        : sheet._count.items + 1;

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.dailySheetItem.create({
        data: {
          dailySheetId: sheetId,
          customerId: order.customerId,
          productId: order.productId,
          sequence,
          deliveryType: 'ON_DEMAND',
          sourceOrderId: order.id,
        },
      });

      await tx.customerOrder.update({
        where: { id: order.id },
        data: {
          dispatchStatus: 'INSERTED_IN_SHEET',
          dispatchedAt: new Date(),
        },
      });

      return item;
    });
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

    if (dto.returnedFilled > load.loadedFilled) {
      throw new BadRequestException(
        `Cannot return more filled bottles (${dto.returnedFilled}) than were loaded (${load.loadedFilled}).`
      );
    }

    const checkinResult = await this.prisma.$transaction(async (tx) => {
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

    const sheetDateCL = sheet.date.toISOString().slice(0, 10);
    await this.cache.invalidateDailyDashboard(vendorId, sheetDateCL);

    return checkinResult;
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

    const sheetDateLO = sheet.date.toISOString().slice(0, 10);
    await this.cache.invalidateDailyDashboard(vendorId, sheetDateLO);

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

    const sheetDateCI = updated.date.toISOString().slice(0, 10);
    await this.cache.invalidateDailyDashboard(vendorId, sheetDateCI);

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
      if (item.pricePerBottle && item.pricePerBottle > 0) return item.pricePerBottle;
      const custom = item.customer?.customPrices?.find(
        (cp: any) => cp.productId === item.productId,
      );
      return custom?.customPrice ?? item.product?.basePrice ?? 0;
    };

    // Bottle summary
    const totalDelivered = activeItems.reduce((s, i) => s + i.filledDropped, 0);
    const bottleDiscrepancy = sheet.filledOutCount - (sheet.filledInCount + totalDelivered);

    // Cash breakdown by payment type
    const cashItems = activeItems.filter((i) => i.customer?.paymentType === PaymentType.CASH);
    const monthlyItems = activeItems.filter((i) => i.customer?.paymentType === PaymentType.MONTHLY);

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

    const openTrip = await this.prisma.dailySheetLoad.findFirst({
      where: { dailySheetId: sheetId, endedAt: null },
    });
    if (openTrip) {
      throw new ConflictException('Cannot close sheet while a trip is still active. Driver must check in first.');
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

    const sheetDate = sheet.date.toISOString().slice(0, 10);
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, sheetDate),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);

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

    const sheetWhere = {
      vendorId,
      driverId,
      isClosed: true,
      date: { gte: startDate, lte: endDate },
    };
    const completedStatuses: DeliveryStatus[] = [DeliveryStatus.COMPLETED, DeliveryStatus.EMPTY_ONLY];

    const [itemStats, failureStats, cashAgg, deliveredPerSheet, sheets] = await Promise.all([
      // aggregate totals by status
      this.prisma.dailySheetItem.groupBy({
        by: ['status'],
        where: { dailySheet: sheetWhere },
        _count: { id: true },
        _sum: { filledDropped: true, emptyReceived: true },
      }),
      // failure breakdown
      this.prisma.dailySheetItem.groupBy({
        by: ['failureCategory'],
        where: { dailySheet: sheetWhere, failureCategory: { not: null } },
        _count: { id: true },
      }),
      // cash totals + sheet count
      this.prisma.dailySheet.aggregate({
        where: sheetWhere,
        _sum: { cashExpected: true, cashCollected: true },
        _count: { id: true },
      }),
      // delivered item count per sheet for the per-sheet list
      this.prisma.dailySheetItem.groupBy({
        by: ['dailySheetId'],
        where: { dailySheet: sheetWhere, status: { in: completedStatuses } },
        _count: { id: true },
      }),
      // sheet list (no items loaded)
      this.prisma.dailySheet.findMany({
        where: sheetWhere,
        select: {
          id: true,
          date: true,
          cashCollected: true,
          cashExpected: true,
          van: { select: { plateNumber: true } },
          route: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const deliveredMap = new Map(deliveredPerSheet.map((r) => [r.dailySheetId, r._count.id]));

    const totalItems = itemStats.reduce((s, r) => s + r._count.id, 0);
    const deliveredCount = itemStats
      .filter((r) => completedStatuses.includes(r.status as DeliveryStatus))
      .reduce((s, r) => s + r._count.id, 0);
    const totalBottles = itemStats
      .filter((r) => completedStatuses.includes(r.status as DeliveryStatus))
      .reduce((s, r) => s + (r._sum.filledDropped ?? 0), 0);
    const totalEmpties = itemStats
      .filter((r) => completedStatuses.includes(r.status as DeliveryStatus))
      .reduce((s, r) => s + (r._sum.emptyReceived ?? 0), 0);
    const failureBreakdown = Object.fromEntries(
      failureStats.map((r) => [r.failureCategory!, r._count.id]),
    );
    const cashExpected = cashAgg._sum.cashExpected ?? 0;
    const cashCollected = cashAgg._sum.cashCollected ?? 0;

    return {
      totalSheets: cashAgg._count.id,
      totalItems,
      deliveredCount,
      successRate: totalItems > 0 ? Math.round((deliveredCount / totalItems) * 100) : 0,
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
        totalItems: s._count.items,
        deliveredItems: deliveredMap.get(s.id) ?? 0,
        cashCollected: s.cashCollected,
        cashExpected: s.cashExpected,
      })),
    };
  }

  async findAll(vendorId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [sheets, total] = await Promise.all([
      this.prisma.dailySheet.findMany({
        where: { vendorId },
        include: {
          route: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          driver: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.dailySheet.count({ where: { vendorId } }),
    ]);
    return { data: sheets, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
