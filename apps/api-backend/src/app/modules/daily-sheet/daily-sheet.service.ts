import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { DeliveryStatus, NoteType, PaymentType, TransactionType } from '@prisma/client';
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
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { InsertOrderItemDto, SequenceMode } from './dto/insert-order-item.dto';
import { AddAdhocItemDto } from './dto/add-adhoc-item.dto';
import { AddCorrectionItemDto } from './dto/add-correction-item.dto';
import { paginate } from '../../common/helpers/paginate';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { UnlockEditDto } from './dto/unlock-edit.dto';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';

const AUTO_GENERATE_CRON = '5 19 * * *'; // 00:05 AM PKT (UTC+5), shortly after the PKT date rolls over
const AUTO_GENERATE_JOB_ID = 'daily-sheet-auto-generation';

@Injectable()
export class DailySheetService implements OnModuleInit {
  private readonly logger = new Logger(DailySheetService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private fcm: FcmService,
    private deliveryIssue: DeliveryIssueService,
    private cache: CacheInvalidationService,
    private notifications: NotificationService,
    private inAppNotifications: InAppNotificationService,
    private storage: StorageService,
    private warehouse: WarehouseService,
    private deliveryReceiptPdf: DeliveryReceiptPdfService,
    @InjectQueue(QUEUE_NAMES.DAILY_SHEET_GENERATION)
    private sheetQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.scheduleAutoGeneration();
  }

  private async scheduleAutoGeneration() {
    const existing = await this.sheetQueue.getRepeatableJobs();
    if (existing.some((j) => j.id === AUTO_GENERATE_JOB_ID)) return;

    await this.sheetQueue.add(
      JOB_NAMES.AUTO_GENERATE_DAILY_SHEETS,
      {},
      {
        repeat: { pattern: AUTO_GENERATE_CRON, utc: true },
        jobId: AUTO_GENERATE_JOB_ID,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );
    this.logger.log(`Daily sheet auto-generation scheduled (${AUTO_GENERATE_CRON} UTC)`);
  }

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

  async submitDelivery(user: AuthUser, itemId: string, dto: SubmitDeliveryDto) {
    const vendorId = user.vendorId;
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        customer: { select: { name: true, customerCode: true, phoneNumber: true, paymentType: true, isBillingExempt: true, customPrices: { select: { productId: true, customPrice: true } } } },
        product: { select: { name: true, basePrice: true } },
        dailySheet: { select: { vendorId: true, date: true, vendor: { select: { name: true } } } },
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
    // Drivers can only force-resubmit if an active unlock window has been granted by staff
    if (dto.forceResubmit && TERMINAL_STATUSES.includes(item.status) && user.role === 'DRIVER') {
      const hasActiveUnlock = item.editUnlockExpiresAt && item.editUnlockExpiresAt > new Date();
      if (!hasActiveUnlock) {
        throw new ForbiddenException('Edit not permitted. Ask staff to unlock this delivery first.');
      }
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

    // Block delivery if there are unacknowledged notes on this item
    const unacknowledgedCount = await this.prisma.deliveryItemNote.count({
      where: { dailySheetItemId: itemId, acknowledgedAt: null },
    });
    if (unacknowledgedCount > 0) {
      throw new BadRequestException(
        `This delivery has ${unacknowledgedCount} unacknowledged note(s). Driver must acknowledge all notes before recording delivery.`,
      );
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
      let updatedWallet: { balance: number } | null = null;
      let updatedCustomer: { financialBalance: number } | null = null;

      const updatedItem = await tx.dailySheetItem.update({
        where: { id: itemId },
        data: {
          status: resolvedStatus,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          reason: dto.reason,
          failureCategory: dto.failureCategory,
          photoKey: dto.photoKey,
          pricePerBottle: price,
          ...(resolvedStatus === DeliveryStatus.COMPLETED || resolvedStatus === DeliveryStatus.EMPTY_ONLY
            ? { deliveredAt: new Date() }
            : { deliveredAt: null }),
          ...(dto.forceResubmit ? { editUnlockedBy: null, editUnlockExpiresAt: null, editRequestedAt: null } : {}),
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
        }, tx);

        updatedWallet = await this.prisma.bottleWallet.findUnique({
          where: { customerId_productId: { customerId: item.customerId, productId: item.productId } },
          select: { balance: true },
        });

        updatedCustomer = await this.prisma.customer.findUnique({
          where: { id: item.customerId },
          select: { financialBalance: true },
        });

        await tx.dailySheetItem.update({
          where: { id: itemId },
          data: {
            bottleBalanceAfter: updatedWallet?.balance ?? null,
            financialBalanceAfter: updatedCustomer?.financialBalance ?? null,
          },
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

        // WhatsApp PDF receipt: only when bottles were actually dropped (not empty-only pickups)
        if (resolvedStatus === DeliveryStatus.COMPLETED && item.customer.phoneNumber) {
          const isCorrection = !!item.whatsappSentAt;
          // Reset whatsappSentAt so processor stamps it fresh after sending
          if (isCorrection) {
            await this.prisma.dailySheetItem
              .update({ where: { id: itemId }, data: { whatsappSentAt: null } })
              .catch(() => {});
          }
          const now = new Date();
          const previousMonthOutstanding =
            item.customer.paymentType === PaymentType.MONTHLY
              ? await this.getPreviousMonthOutstanding(
                  vendorId,
                  item.customerId,
                  updatedCustomer?.financialBalance ?? 0,
                  item.dailySheet.date,
                )
              : undefined;
          const receiptData = {
            customerName: item.customer.name,
            customerCode: item.customer.customerCode,
            productName: item.product.name,
            filledDropped: dto.filledDropped,
            emptyReceived: dto.emptyReceived ?? 0,
            cashCollected: dto.cashCollected ?? 0,
            pricePerBottle: price,
            financialBalanceAfter: updatedCustomer?.financialBalance ?? 0,
            bottleBalanceAfter: updatedWallet?.balance ?? 0,
            deliveryDate: item.dailySheet.date.toISOString().slice(0, 10),
            deliveryTime: now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }),
            vendorName: item.dailySheet.vendor?.name ?? 'Water Supply',
            previousMonthOutstanding,
          };
          this.notifications.queueWhatsAppPdf(
            item.customer.phoneNumber,
            receiptData,
            { entityType: 'DELIVERY_ITEM', entityId: itemId },
          ).catch((e: Error) => this.logger.warn(`WhatsApp PDF delivery-${isCorrection ? 'correction' : 'complete'} failed for item ${itemId}: ${e.message}`));
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

  async unlockDeliveryEdit(user: AuthUser, itemId: string, dto: UnlockEditDto) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { dailySheet: { select: { vendorId: true } } },
    });

    if (!item || item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Sheet item not found');
    }

    const TERMINAL_STATUSES = ['COMPLETED', 'EMPTY_ONLY', 'NOT_AVAILABLE', 'CANCELLED'];
    if (!TERMINAL_STATUSES.includes(item.status)) {
      throw new BadRequestException('Item is not in a terminal status');
    }

    const windowMinutes = dto.windowMinutes ?? 30;
    const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000);

    const updated = await this.prisma.dailySheetItem.update({
      where: { id: itemId },
      data: {
        editUnlockedBy: user.userId,
        editUnlockExpiresAt: expiresAt,
        editRequestedAt: null,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      action: 'DELIVERY_EDIT_UNLOCK',
      entity: 'DailySheetItem',
      entityId: itemId,
      changes: {
        after: {
          unlockedBy: user.userId,
          windowMinutes,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return updated;
  }

  async requestDeliveryEdit(user: AuthUser, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        dailySheet: { select: { id: true, vendorId: true, driverId: true, date: true } },
        customer: { select: { name: true } },
      },
    });

    if (!item || item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Sheet item not found');
    }

    if (item.dailySheet.driverId !== user.userId) {
      throw new ForbiddenException('Only the assigned driver can request an edit');
    }

    const TERMINAL_STATUSES = ['COMPLETED', 'EMPTY_ONLY', 'NOT_AVAILABLE', 'CANCELLED'];
    if (!TERMINAL_STATUSES.includes(item.status)) {
      throw new BadRequestException('Item is not in a terminal status');
    }

    const updated = await this.prisma.dailySheetItem.update({
      where: { id: itemId },
      data: { editRequestedAt: new Date() },
    });

    // Notify all VENDOR_ADMIN and STAFF users for this vendor
    const sheetId = item.dailySheet.id;
    const customerName = item.customer?.name ?? 'Customer';
    const driverName = user.name ?? 'Driver';
    const dateStr = new Date(item.dailySheet.date).toLocaleDateString('en-PK', {
      day: 'numeric', month: 'short',
    });

    const adminUsers = await this.prisma.user.findMany({
      where: { vendorId: user.vendorId, role: { in: ['VENDOR_ADMIN', 'STAFF'] }, isActive: true },
      select: { id: true },
    });

    await Promise.all(
      adminUsers.map(async (admin) => {
        await this.inAppNotifications.create({
          userId: admin.id,
          vendorId: user.vendorId,
          type: 'DELIVERY_EDIT_REQUESTED',
          title: `Edit Request — ${customerName}`,
          message: `${driverName} requests to edit delivery #${item.sequence} for ${customerName} (${dateStr}).`,
          entityId: sheetId,
        });
        await this.notifications.queueFcm(
          admin.id,
          `Edit Request — ${customerName}`,
          `${driverName} wants to edit delivery #${item.sequence} for ${customerName} (${dateStr}).`,
          { type: 'DELIVERY_EDIT_REQUESTED', sheetId },
        );
      }),
    );

    return updated;
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
        vendor: { select: { name: true, address: true, logoUrl: true, raastId: true } },
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
            notes: {
              include: { createdBy: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { sequence: 'asc' },
        },
        loads: {
          orderBy: { tripNumber: 'asc' },
        },
        expenses: {
          include: {
            van: { select: { id: true, plateNumber: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
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

      // Batch 30-day empty return rate: emptyReceived / filledDropped × 100
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentDeliveries30d = await this.prisma.dailySheetItem.findMany({
        where: {
          status: { in: ['COMPLETED', 'EMPTY_ONLY'] },
          dailySheet: { vendorId },
          updatedAt: { gte: thirtyDaysAgo },
          OR: itemPairs.map((p) => ({ customerId: p.customerId, productId: p.productId })),
        },
        select: { customerId: true, productId: true, filledDropped: true, emptyReceived: true },
      });
      const filledMap = new Map<string, number>();
      const emptyMap = new Map<string, number>();
      for (const d of recentDeliveries30d) {
        const key = `${d.customerId}:${d.productId}`;
        filledMap.set(key, (filledMap.get(key) ?? 0) + d.filledDropped);
        emptyMap.set(key, (emptyMap.get(key) ?? 0) + d.emptyReceived);
      }
      for (const it of sheet.items as any[]) {
        const key = `${it.customerId}:${it.productId}`;
        const filled = filledMap.get(key) ?? 0;
        const empty = emptyMap.get(key) ?? 0;
        if (it.customer) {
          it.customer.consumptionRate30d = filled > 0 ? Math.round((empty / filled) * 100) : null;
        }
      }

      // Batch prev-month outstanding for MONTHLY customers (single groupBy query)
      const monthlyCustomerIds = [
        ...new Set(
          (sheet.items as any[])
            .filter((it) => it.customer?.paymentType === 'MONTHLY')
            .map((it) => it.customerId as string),
        ),
      ];
      if (monthlyCustomerIds.length > 0) {
        const sheetDate = new Date((sheet as any).date);
        const curMonthStart = new Date(sheetDate.getFullYear(), sheetDate.getMonth(), 1);
        const curMonthTxns = await this.prisma.transaction.groupBy({
          by: ['customerId'],
          where: {
            customerId: { in: monthlyCustomerIds },
            vendorId,
            createdAt: { gte: curMonthStart },
          },
          _sum: { amount: true },
        });
        const txnMap = new Map(curMonthTxns.map((t) => [t.customerId, t._sum.amount ?? 0]));
        for (const it of sheet.items as any[]) {
          if (it.customer?.paymentType === 'MONTHLY') {
            const fromThisMonth = txnMap.get(it.customerId) ?? 0;
            it.customer.previousMonthOutstanding =
              (it.customer.financialBalance ?? 0) - fromThisMonth;
          }
        }
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

  async addAdhocItem(user: AuthUser, sheetId: string, dto: AddAdhocItemDto) {
    const vendorId = user.vendorId;

    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      include: { _count: { select: { items: true } } },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Cannot add ad-hoc delivery to a closed sheet. Use correction entry for closed sheets.');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, vendorId },
      include: { customPrices: { select: { productId: true, customPrice: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const customPrice = customer.customPrices.find((p) => p.productId === dto.productId);
    const price =
      dto.priceOverride !== undefined
        ? dto.priceOverride
        : customer.isBillingExempt
          ? 0
          : customPrice
            ? customPrice.customPrice
            : product.basePrice;

    const sequence = sheet._count.items + 1;

    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.dailySheetItem.create({
        data: {
          dailySheetId: sheetId,
          customerId: dto.customerId,
          productId: dto.productId,
          sequence,
          deliveryType: 'ON_DEMAND',
          status: DeliveryStatus.COMPLETED,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          pricePerBottle: price,
          deliveredAt: new Date(),
        },
      });

      await this.ledger.recordDelivery({
        vendorId,
        customerId: dto.customerId,
        productId: dto.productId,
        dailySheetId: sheetId,
        dailySheetItemId: item.id,
        filledDropped: dto.filledDropped,
        emptyReceived: dto.emptyReceived,
        cashCollected: dto.cashCollected,
        pricePerBottle: price,
      }, tx);

      const updatedWallet = await this.prisma.bottleWallet.findUnique({
        where: { customerId_productId: { customerId: dto.customerId, productId: dto.productId } },
        select: { balance: true },
      });
      const updatedCustomer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
        select: { financialBalance: true },
      });

      return tx.dailySheetItem.update({
        where: { id: item.id },
        data: {
          bottleBalanceAfter: updatedWallet?.balance ?? null,
          financialBalanceAfter: updatedCustomer?.financialBalance ?? null,
        },
      });
    });

    await this.audit.log({
      vendorId,
      action: 'ADHOC_DELIVERY_ADDED',
      entity: 'DailySheetItem',
      entityId: result.id,
      changes: { after: { customerId: dto.customerId, productId: dto.productId, filledDropped: dto.filledDropped } },
    });

    const sheetDate = sheet.date.toISOString().slice(0, 10);
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, sheetDate),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);

    return result;
  }

  async addCorrectionItem(user: AuthUser, sheetId: string, dto: AddCorrectionItemDto) {
    const vendorId = user.vendorId;

    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      include: { _count: { select: { items: true } } },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (!sheet.isClosed) throw new ConflictException('Correction entries can only be added to closed sheets. For open sheets, use ad-hoc delivery.');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, vendorId },
      include: { customPrices: { select: { productId: true, customPrice: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const customPrice = customer.customPrices.find((p) => p.productId === dto.productId);
    const price =
      dto.priceOverride !== undefined
        ? dto.priceOverride
        : customer.isBillingExempt
          ? 0
          : customPrice
            ? customPrice.customPrice
            : product.basePrice;

    const sequence = sheet._count.items + 1;
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.dailySheetItem.create({
        data: {
          dailySheetId: sheetId,
          customerId: dto.customerId,
          productId: dto.productId,
          sequence,
          deliveryType: 'ON_DEMAND',
          status: DeliveryStatus.COMPLETED,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          pricePerBottle: price,
          deliveredAt: sheet.date,
          isCorrection: true,
          correctionAddedAt: now,
          correctionNote: dto.correctionNote,
        },
      });

      await this.ledger.recordDelivery({
        vendorId,
        customerId: dto.customerId,
        productId: dto.productId,
        dailySheetId: sheetId,
        dailySheetItemId: item.id,
        filledDropped: dto.filledDropped,
        emptyReceived: dto.emptyReceived,
        cashCollected: dto.cashCollected,
        pricePerBottle: price,
      }, tx);

      const updatedWallet = await this.prisma.bottleWallet.findUnique({
        where: { customerId_productId: { customerId: dto.customerId, productId: dto.productId } },
        select: { balance: true },
      });
      const updatedCustomer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
        select: { financialBalance: true },
      });

      return tx.dailySheetItem.update({
        where: { id: item.id },
        data: {
          bottleBalanceAfter: updatedWallet?.balance ?? null,
          financialBalanceAfter: updatedCustomer?.financialBalance ?? null,
        },
      });
    });

    await this.audit.log({
      vendorId,
      action: 'CORRECTION_ENTRY_ADDED',
      entity: 'DailySheetItem',
      entityId: result.id,
      changes: {
        after: {
          customerId: dto.customerId,
          productId: dto.productId,
          filledDropped: dto.filledDropped,
          correctionNote: dto.correctionNote,
          sheetDate: sheet.date.toISOString().slice(0, 10),
        },
      },
    });

    const sheetDate = sheet.date.toISOString().slice(0, 10);
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, sheetDate),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);

    return result;
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

    const load = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dailySheetLoad.create({
        data: { dailySheetId: sheetId, tripNumber, loadedFilled: dto.loadedFilled, productId: dto.productId },
      });
      await tx.dailySheet.update({
        where: { id: sheetId },
        data: { filledOutCount: { increment: dto.loadedFilled } },
      });
      if (dto.productId) {
        await this.warehouse.recordLoadOut(vendorId, dto.productId, dto.loadedFilled, sheetId, tx);
      }
      return created;
    });

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
          damagedOnVan: dto.damagedOnVan,
          leakedOnVan: dto.leakedOnVan,
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

      if (load.productId) {
        await this.warehouse.recordCheckinFilled(vendorId, load.productId, dto.returnedFilled, sheetId, tx);
        await this.warehouse.recordCheckinEmpty(vendorId, load.productId, dto.collectedEmpty, sheetId, tx);
        await this.warehouse.recordCheckinDamaged(vendorId, load.productId, dto.damagedOnVan, sheetId, tx);
        await this.warehouse.recordCheckinLeaked(vendorId, load.productId, dto.leakedOnVan, sheetId, tx);
      }

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

    // Empty bottle summary
    const totalEmptyCollected = activeItems.reduce((s, i) => s + i.emptyReceived, 0);
    const emptyDiscrepancy = totalEmptyCollected - sheet.emptyInCount;

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

    const totalExpenses = ((sheet.expenses ?? []) as any[]).reduce(
      (s: number, e: any) => s + e.amount,
      0,
    );

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
      empties: {
        collectedFromCustomers: totalEmptyCollected,
        returnedToWarehouse: sheet.emptyInCount,
        discrepancy: emptyDiscrepancy,
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
      expenses: {
        total: totalExpenses,
      },
      driver: {
        shouldHandIn: totalCashRecorded,
        expensePaidFromCash: totalExpenses,
        netToHandIn: Math.max(0, totalCashRecorded - totalExpenses),
        handedIn: sheet.cashCollected,
        discrepancy: driverDiscrepancy,
        unexplainedDiscrepancy: driverDiscrepancy - totalExpenses,
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
        expenses: {
          select: { amount: true },
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
        cashExpected: reconciliation.driver.netToHandIn,
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
          emptyDiscrepancy: reconciliation.empties.discrepancy,
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

  async getCustomerDeliveryHistory(vendorId: string, customerId: string, limit = 6) {
    return this.prisma.dailySheetItem.findMany({
      where: {
        customerId,
        status: { in: ['COMPLETED', 'EMPTY_ONLY'] },
        dailySheet: { vendorId },
      },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
      select: {
        id: true,
        filledDropped: true,
        emptyReceived: true,
        cashCollected: true,
        pricePerBottle: true,
        bottleBalanceAfter: true,
        financialBalanceAfter: true,
        deliveredAt: true,
        dailySheet: { select: { date: true } },
      },
    });
  }

  /**
   * Per-customer monthly financial snapshot for the delivery record form.
   * The "current" month is anchored to the daily sheet's date (not today),
   * so opening an old sheet shows the figures for that sheet's month.
   */
  async getCustomerFinancialSummary(
    vendorId: string,
    customerId: string,
    sheetId: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      select: { financialBalance: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      select: { date: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');

    const anchor = new Date(sheet.date);
    const curMonthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const nextMonthStart = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);

    // Current month payments (PAYMENT amounts are negative — show absolute value).
    const curPayments = await this.prisma.transaction.aggregate({
      where: {
        customerId,
        vendorId,
        type: 'PAYMENT',
        createdAt: { gte: curMonthStart, lt: nextMonthStart },
      },
      _sum: { amount: true },
    });
    const currentMonthPaid = Math.abs(curPayments._sum.amount ?? 0);

    // Balance at the end of the previous month = opening balance of the current
    // month = live balance minus everything that happened from the current
    // month onward.
    const fromCurrentMonth = await this.prisma.transaction.aggregate({
      where: { customerId, vendorId, createdAt: { gte: curMonthStart } },
      _sum: { amount: true },
    });
    const prevMonthOutstanding =
      customer.financialBalance - (fromCurrentMonth._sum.amount ?? 0);

    return {
      currentMonthPaid,
      prevMonthOutstanding,
      currentOutstanding: customer.financialBalance,
    };
  }

  // ── Delivery Item Notes ───────────────────────────────────────────────────

  private async resolveItemForNotes(vendorId: string, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { dailySheet: { select: { vendorId: true } } },
    });
    if (!item || item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Sheet item not found');
    }
    return item;
  }

  async getNotes(vendorId: string, itemId: string) {
    await this.resolveItemForNotes(vendorId, itemId);
    return this.prisma.deliveryItemNote.findMany({
      where: { dailySheetItemId: itemId },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addTextNote(user: AuthUser, itemId: string, dto: CreateDeliveryNoteDto) {
    await this.resolveItemForNotes(user.vendorId, itemId);
    if (!dto.text?.trim()) {
      throw new BadRequestException('Note text is required for TEXT type notes');
    }
    return this.prisma.deliveryItemNote.create({
      data: {
        vendorId: user.vendorId,
        dailySheetItemId: itemId,
        createdById: user.userId,
        type: NoteType.TEXT,
        text: dto.text.trim(),
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async addVoiceNote(
    user: AuthUser,
    itemId: string,
    file: Express.Multer.File,
    audioDuration?: number,
  ) {
    await this.resolveItemForNotes(user.vendorId, itemId);

    let uploadResult: { key: string };
    try {
      uploadResult = await this.storage.upload(
        'delivery-voice-notes',
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } catch (err) {
      this.logger.error(
        `Voice note upload failed: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
      throw new InternalServerErrorException('Failed to upload voice note');
    }

    return this.prisma.deliveryItemNote.create({
      data: {
        vendorId: user.vendorId,
        dailySheetItemId: itemId,
        createdById: user.userId,
        type: NoteType.VOICE,
        audioKey: uploadResult.key,
        audioDuration: audioDuration ?? null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async acknowledgeNote(user: AuthUser, noteId: string) {
    const note = await this.prisma.deliveryItemNote.findUnique({
      where: { id: noteId },
      include: { item: { include: { dailySheet: { select: { vendorId: true } } } } },
    });
    if (!note || note.item.dailySheet.vendorId !== user.vendorId) {
      throw new NotFoundException('Note not found');
    }
    if (note.acknowledgedAt) {
      return note; // already acknowledged — idempotent
    }
    return this.prisma.deliveryItemNote.update({
      where: { id: noteId },
      data: { acknowledgedAt: new Date(), acknowledgedById: user.userId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async getNoteAudioUrl(vendorId: string, noteId: string) {
    const note = await this.prisma.deliveryItemNote.findUnique({
      where: { id: noteId },
      include: { item: { include: { dailySheet: { select: { vendorId: true } } } } },
    });
    if (!note || note.item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Note not found');
    }
    if (note.type !== NoteType.VOICE || !note.audioKey) {
      throw new BadRequestException('This note does not have a voice recording');
    }
    const signedUrl = await this.storage.getSignedUrl(note.audioKey, 900);
    return { signedUrl };
  }

  async getDeliveryPhotoUrl(vendorId: string, itemId: string) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { dailySheet: { select: { vendorId: true } } },
    });
    if (!item || item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Delivery item not found');
    }
    if (!item.photoKey) {
      throw new BadRequestException('This delivery item does not have a photo attached');
    }
    const signedUrl = await this.storage.getSignedUrl(item.photoKey, 900);
    return { signedUrl };
  }

  async getDeliveryReceiptPdf(vendorId: string, itemId: string): Promise<Buffer> {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: {
        customer: { select: { name: true, customerCode: true, paymentType: true, financialBalance: true } },
        product: { select: { name: true } },
        dailySheet: { select: { date: true, vendorId: true, vendor: { select: { name: true } } } },
      },
    });
    if (!item || item.dailySheet.vendorId !== vendorId) {
      throw new NotFoundException('Delivery item not found');
    }
    if (item.status !== DeliveryStatus.COMPLETED) {
      throw new BadRequestException('Receipt is only available for completed deliveries');
    }

    const previousMonthOutstanding =
      item.customer.paymentType === PaymentType.MONTHLY
        ? await this.getPreviousMonthOutstanding(vendorId, item.customerId, item.customer.financialBalance, item.dailySheet.date)
        : undefined;

    const deliveredAt = item.deliveredAt ?? item.dailySheet.date;
    return this.deliveryReceiptPdf.generate({
      customerName: item.customer.name,
      customerCode: item.customer.customerCode,
      productName: item.product.name,
      filledDropped: item.filledDropped,
      emptyReceived: item.emptyReceived,
      cashCollected: item.cashCollected,
      pricePerBottle: item.pricePerBottle,
      financialBalanceAfter: item.financialBalanceAfter ?? 0,
      bottleBalanceAfter: item.bottleBalanceAfter ?? 0,
      deliveryDate: item.dailySheet.date.toISOString().slice(0, 10),
      deliveryTime: deliveredAt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }),
      vendorName: item.dailySheet.vendor?.name ?? 'Water Supply',
      previousMonthOutstanding,
    });
  }

  /** Balance carried in from before the current calendar month (MONTHLY customers only). */
  private async getPreviousMonthOutstanding(
    vendorId: string,
    customerId: string,
    currentFinancialBalance: number,
    referenceDate: Date,
  ): Promise<number> {
    const curMonthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const agg = await this.prisma.transaction.aggregate({
      where: { customerId, vendorId, createdAt: { gte: curMonthStart } },
      _sum: { amount: true },
    });
    return (currentFinancialBalance ?? 0) - (agg._sum.amount ?? 0);
  }
}
