import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { DeliveryStatus, PaymentType, TransactionType, NotificationType, NotificationChannel, Prisma, CrewRole } from '@prisma/client';
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
import { MoveDeliveryItemsDto } from './dto/move-delivery-items.dto';
import { paginate } from '../../common/helpers/paginate';
import { validateSupportCrew } from '../../common/helpers/crew-validation';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { UnlockEditDto } from './dto/unlock-edit.dto';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';

const AUTO_GENERATE_CRON = '5 0 * * *'; // 00:05 AM, evaluated in AUTO_GENERATE_TZ
const AUTO_GENERATE_TZ = 'Asia/Karachi';
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
    private notifSettings: NotificationSettingsService,
    @InjectQueue(QUEUE_NAMES.DAILY_SHEET_GENERATION)
    private sheetQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      await this.scheduleAutoGeneration();
    } catch (err) {
      this.logger.error(
        `Failed to schedule daily sheet auto-generation: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  private async scheduleAutoGeneration() {
    // Clean up the legacy repeatable job (registered via add() + jobId in older
    // builds). Its cron pattern was frozen at first registration and never
    // updated on redeploy, so it must be removed before the scheduler takes over.
    const legacy = await this.sheetQueue.getRepeatableJobs();
    for (const j of legacy) {
      if (j.id === AUTO_GENERATE_JOB_ID && j.key !== AUTO_GENERATE_JOB_ID) {
        await this.sheetQueue.removeRepeatableByKey(j.key);
        this.logger.warn(
          `Removed legacy auto-generation repeatable job (key=${j.key}, pattern=${j.pattern}, tz=${j.tz ?? 'server-local'})`,
        );
      }
    }

    // upsertJobScheduler is idempotent and updates the pattern/tz if they
    // changed since the last deploy — unlike add({ repeat }) which is
    // first-write-wins.
    const nextJob = await this.sheetQueue.upsertJobScheduler(
      AUTO_GENERATE_JOB_ID,
      { pattern: AUTO_GENERATE_CRON, tz: AUTO_GENERATE_TZ },
      {
        name: JOB_NAMES.AUTO_GENERATE_DAILY_SHEETS,
        opts: { removeOnComplete: 30, removeOnFail: 20 },
      },
    );
    const nextRun = nextJob
      ? new Date(nextJob.timestamp + (nextJob.delay ?? 0)).toISOString()
      : 'unknown';
    this.logger.log(
      `Daily sheet auto-generation scheduled (${AUTO_GENERATE_CRON} ${AUTO_GENERATE_TZ}) — next run at ${nextRun}`,
    );
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

  /**
   * Get-or-create a van's sheet for a given date. Used both by a standalone
   * caller (e.g. the customer-move feature, which needs a destination sheet
   * that may not exist yet) — never by the bulk generation processor's hot
   * loop, which already has the van/product/orders in scope and calls
   * `createSheetForVan` directly to avoid redundant per-van queries.
   */
  async ensureSheetForVanDate(
    db: Prisma.TransactionClient | PrismaService,
    vendorId: string,
    vanId: string,
    date: string,
  ): Promise<{ sheet: { id: string; isClosed: boolean }; createdNewSheet: boolean }> {
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await db.dailySheet.findFirst({
      where: { vendorId, vanId, date: { gte: startOfDay, lt: endOfDay } },
    });
    if (existing) {
      return { sheet: existing, createdNewSheet: false };
    }

    const dayOfWeek = targetDate.getDay();

    const van = await db.van.findFirst({
      where: { id: vanId, vendorId },
      include: {
        routes: { where: { vendorId }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
        defaultCrew: {
          where: { user: { isActive: true } },
          select: { userId: true, role: true },
        },
        deliverySchedules: {
          where: { dayOfWeek, customer: { isActive: true } },
          select: { customerId: true, routeSequence: true },
          orderBy: [{ routeSequence: 'asc' }, { customer: { name: 'asc' } }],
        },
      },
    });
    if (!van) {
      throw new NotFoundException('Van not found');
    }
    if (!van.defaultDriverId) {
      throw new ConflictException('Destination van has no default driver assigned — cannot create a sheet');
    }

    const defaultProduct = await db.product.findFirst({ where: { vendorId, isActive: true } });
    if (!defaultProduct) {
      throw new ConflictException('No active product is configured for this vendor — cannot create a sheet');
    }

    const plannedOrders = await db.customerOrder.findMany({
      where: {
        vendorId,
        status: 'APPROVED',
        dispatchStatus: 'PLANNED',
        dispatchMode: 'QUEUE_FOR_GENERATION',
        targetDate: { gte: startOfDay, lte: endOfDay },
        OR: [{ dispatchVanId: van.id }, { dispatchVanId: null }],
      },
    });

    const { sheet } = await this.createSheetForVan(
      db,
      vendorId,
      van,
      targetDate,
      dayOfWeek,
      defaultProduct,
      plannedOrders,
    );
    return { sheet, createdNewSheet: true };
  }

  /**
   * Builds and creates a single van's sheet for a date: regular schedule
   * items, rescheduled-item pull-forward (auto-cancelling anything older
   * than 60 days), and eligible on-demand orders. Extracted verbatim from
   * `DailySheetProcessor.generateForVendor`'s per-van loop body so the
   * nightly/manual generation path and the one-off `ensureSheetForVanDate`
   * caller share identical sheet-creation behavior. `plannedOrders` is
   * filtered internally to this van (or unassigned); the caller is
   * responsible for removing any orders this call consumed from a
   * vendor-wide pool shared across multiple vans (see the processor).
   */
  async createSheetForVan(
    db: Prisma.TransactionClient | PrismaService,
    vendorId: string,
    van: {
      id: string;
      defaultDriverId: string | null;
      routes: { id: string }[];
      defaultCrew: { userId: string; role: CrewRole }[];
      deliverySchedules: { customerId: string; routeSequence: number | null }[];
    },
    targetDate: Date,
    dayOfWeek: number,
    defaultProduct: { id: string },
    plannedOrders: { id: string; customerId: string; productId: string; dispatchVanId: string | null }[],
  ): Promise<{
    sheet: { id: string; isClosed: boolean };
    eligibleOnDemandOrderIds: string[];
    alreadyInsertedOnDemandOrderIds: string[];
  }> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const schedules = van.deliverySchedules;
    const routeId = van.routes[0]?.id ?? null;

    // Fetch any RESCHEDULED items from previous sheets for customers on this van's schedule
    const customerIds = schedules.map((s) => s.customerId);
    const cutoffDate = new Date(targetDate);
    cutoffDate.setDate(cutoffDate.getDate() - 60);

    const rescheduledItems = await db.dailySheetItem.findMany({
      where: {
        status: 'RESCHEDULED',
        customerId: { in: customerIds },
        dailySheet: { vendorId, date: { gte: cutoffDate, lt: targetDate } },
      },
      select: { id: true, customerId: true, productId: true },
    });

    // Auto-cancel RESCHEDULED items older than 60 days for these customers
    await db.dailySheetItem.updateMany({
      where: {
        status: 'RESCHEDULED',
        customerId: { in: customerIds },
        dailySheet: { vendorId, date: { lt: cutoffDate } },
      },
      data: { status: 'CANCELLED' },
    });

    // Build unique set of rescheduled customerIds to avoid duplicates
    const rescheduledCustomerIds = new Set(rescheduledItems.map((i) => i.customerId));

    // Regular scheduled customers (exclude those already covered by rescheduled)
    const regularSchedules = schedules.filter((s) => !rescheduledCustomerIds.has(s.customerId));

    // On-demand orders assigned to this van (or unassigned)
    const vanOnDemandOrders = plannedOrders.filter(
      (o) => o.dispatchVanId === van.id || o.dispatchVanId === null,
    );

    // Idempotency: skip orders already inserted into any sheet for this vendor+date
    const alreadyInsertedOrderIds = new Set<string>();
    if (vanOnDemandOrders.length > 0) {
      const existingItems = await db.dailySheetItem.findMany({
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

    // Snapshot the van's default supporting crew onto the sheet. The crew
    // must be explicitly confirmed (crewConfirmed=false) before trips start.
    const crewSnapshot = van.defaultCrew.filter((c) => c.userId !== van.defaultDriverId);

    const sheet = await db.dailySheet.create({
      data: {
        vendorId,
        routeId,
        vanId: van.id,
        driverId: van.defaultDriverId as string,
        date: targetDate,
        items: { create: allItems },
        crew: {
          create: crewSnapshot.map((c) => ({ userId: c.userId, role: c.role })),
        },
      },
    });

    // Mark old RESCHEDULED items as CANCELLED (moved to new sheet)
    if (rescheduledItems.length > 0) {
      await db.dailySheetItem.updateMany({
        where: { id: { in: rescheduledItems.map((i) => i.id) } },
        data: { status: 'CANCELLED' },
      });
    }

    // Update on-demand orders to INSERTED_IN_SHEET
    if (eligibleOnDemandOrders.length > 0) {
      await db.customerOrder.updateMany({
        where: { id: { in: eligibleOnDemandOrders.map((o) => o.id) } },
        data: { dispatchStatus: 'INSERTED_IN_SHEET', dispatchedAt: new Date() },
      });
    }

    return {
      sheet,
      eligibleOnDemandOrderIds: eligibleOnDemandOrders.map((o) => o.id),
      alreadyInsertedOnDemandOrderIds: Array.from(alreadyInsertedOrderIds),
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

    // Block delivery while instruction messages (requiresAck) on this item are
    // unacknowledged. Casual conversation replies do NOT block (Communication
    // Center §9); pre-existing notes were backfilled requiresAck=true.
    const unacknowledgedCount = await this.prisma.conversationMessage.count({
      where: { dailySheetItemId: itemId, requiresAck: true, acknowledgedAt: null, deletedAt: null },
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

    // Resolve the delivery push master-switch BEFORE the transaction so the
    // gate check never adds I/O inside the interactive transaction.
    const deliveryPushEnabled = await this.notifSettings.isEnabled(
      vendorId,
      NotificationType.DELIVERY_RECEIPT,
      NotificationChannel.PUSH,
    );

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
        if (deliveryPushEnabled) {
          this.fcm.sendToCustomer(
            item.customerId,
            'Delivery Completed',
            `${dto.filledDropped} bottle(s) delivered. Empty received: ${dto.emptyReceived}.`,
            { type: 'DELIVERY', itemId },
          ).catch((e: Error) => this.logger.warn(`FCM delivery-complete failed for item ${itemId}: ${e.message}`));
        }

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
            { entityType: 'DELIVERY_ITEM', entityId: itemId, vendorId, type: NotificationType.DELIVERY_RECEIPT },
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

      // FCM: notify customer on any delivery failure (fire-and-forget).
      // Gated with the delivery push flow so the vendor's master switch applies.
      if (
        deliveryPushEnabled &&
        (resolvedStatus === DeliveryStatus.NOT_AVAILABLE ||
          resolvedStatus === DeliveryStatus.RESCHEDULED ||
          resolvedStatus === DeliveryStatus.CANCELLED)
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
          crew: {
            include: { user: { select: { id: true, name: true, role: true } } },
          },
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

  // ── CSV Export ────────────────────────────────────────────────────────

  // Resolves the van list for export: explicit vanIds (validated to belong
  // to the vendor) or, if omitted, every active van for the vendor.
  private async resolveExportVans(vendorId: string, vanIds?: string[]) {
    if (vanIds && vanIds.length > 0) {
      const vans = await this.prisma.van.findMany({
        where: { id: { in: vanIds }, vendorId },
        select: { id: true, plateNumber: true },
      });
      if (vans.length !== vanIds.length) {
        throw new BadRequestException('One or more selected vans were not found');
      }
      return vans;
    }
    return this.prisma.van.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, plateNumber: true },
    });
  }

  async getExportPreview(vendorId: string, dto: { date: string; vanIds?: string[] }) {
    const vans = await this.resolveExportVans(vendorId, dto.vanIds);

    const d = new Date(dto.date);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);

    const perVan = await Promise.all(
      vans.map(async (van) => {
        const sheet = await this.prisma.dailySheet.findFirst({
          where: { vendorId, vanId: van.id, date: { gte: d, lt: next } },
          select: { items: { select: { status: true } } },
        });

        const items = sheet?.items ?? [];
        const completed = items.filter(
          (i) => i.status === DeliveryStatus.COMPLETED || i.status === DeliveryStatus.EMPTY_ONLY,
        ).length;
        const pending = items.filter((i) => i.status === DeliveryStatus.PENDING).length;
        const cancelledStatuses: string[] = ['CANCELLED', 'NOT_AVAILABLE', 'RESCHEDULED'];
        const cancelled = items.filter((i) => cancelledStatuses.includes(i.status)).length;

        return { vanId: van.id, plateNumber: van.plateNumber, completed, pending, cancelled };
      }),
    );

    const totals = perVan.reduce(
      (acc, v) => ({
        completed: acc.completed + v.completed,
        pending: acc.pending + v.pending,
        cancelled: acc.cancelled + v.cancelled,
      }),
      { completed: 0, pending: 0, cancelled: 0 },
    );

    return { perVan, totals };
  }

  // Escapes a CSV field: wraps in double-quotes (doubling internal quotes)
  // whenever the value contains a comma or a quote.
  private csvEscape(value: unknown): string {
    const s = value == null ? '' : String(value);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async generateExportCsv(vendorId: string, dto: { date: string; vanIds?: string[] }): Promise<string> {
    const vans = await this.resolveExportVans(vendorId, dto.vanIds);
    const vanIds = vans.map((v) => v.id);

    const header = 'Code,Customer Name,Type,Bot Balance,Outstanding Amount,Drop,Empty,Amount Received';
    if (vanIds.length === 0) {
      return header;
    }

    const d = new Date(dto.date);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);

    const items = await this.prisma.dailySheetItem.findMany({
      where: {
        status: { in: [DeliveryStatus.COMPLETED, DeliveryStatus.EMPTY_ONLY] },
        dailySheet: { vendorId, vanId: { in: vanIds }, date: { gte: d, lt: next } },
      },
      include: {
        customer: { select: { customerCode: true, name: true } },
      },
      orderBy: { sequence: 'asc' },
    });

    const rows = items.map((item) =>
      [
        item.customer.customerCode,
        item.customer.name,
        '',
        item.bottleBalanceAfter,
        item.financialBalanceAfter,
        item.filledDropped,
        item.emptyReceived,
        item.cashCollected,
      ]
        .map((v) => this.csvEscape(v))
        .join(','),
    );

    return [header, ...rows].join('\n');
  }

  async findOne(vendorId: string, id: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id, vendorId },
      include: {
        vendor: { select: { name: true, address: true, logoUrl: true, raastId: true } },
        route: true,
        van: true,
        driver: true,
        crew: {
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
        crewConfirmedBy: { select: { id: true, name: true } },
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
            // Communication Center summary (Phase 7) — the full message list
            // moved to ConversationThread's own fetch (GET /conversations/:id/
            // messages); the sheet payload only needs enough to render the row
            // chip and (via pendingAckCount) the requiresAck delivery gate.
            // Conversation.messageCount is the existing transactional rollup
            // (Phase 1/2) — no live count needed for the total.
            conversation: { select: { messageCount: true } },
            _count: {
              select: {
                notes: { where: { requiresAck: true, acknowledgedAt: null, deletedAt: null } },
              },
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

    // Communication Center summary (Phase 7): collapse the conversation/_count
    // sub-objects into two flat numbers and drop the raw shapes from the
    // response — same in-place-mutation idiom as lastFilledDropped/
    // consumptionRate30d below.
    for (const it of sheet.items as any[]) {
      it.messageCount = it.conversation?.messageCount ?? 0;
      it.pendingAckCount = it._count.notes;
      delete it.conversation;
      delete it._count;
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

    // Leave the delivery pending when the admin only picked a customer and left
    // Drop, Empty, and Cash all blank — the driver still needs to complete it.
    const hasDeliveryValues =
      dto.filledDropped > 0 || dto.emptyReceived > 0 || dto.cashCollected > 0;
    const resolvedStatus = hasDeliveryValues ? DeliveryStatus.COMPLETED : DeliveryStatus.PENDING;

    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.dailySheetItem.create({
        data: {
          dailySheetId: sheetId,
          customerId: dto.customerId,
          productId: dto.productId,
          sequence,
          deliveryType: 'ON_DEMAND',
          status: resolvedStatus,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          pricePerBottle: price,
          deliveredAt: hasDeliveryValues ? new Date() : null,
        },
      });

      if (hasDeliveryValues) {
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
      }

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
    if (!sheet.crewConfirmed) {
      throw new ConflictException('Crew confirmation is required before starting the trip.');
    }

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
    if (!sheet.crewConfirmed) {
      throw new ConflictException('Crew confirmation is required before starting the trip.');
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
    if (!dto.driverId && !dto.vanId && !dto.crew) {
      throw new UnprocessableEntityException(
        'Provide at least one of: driverId, vanId, crew',
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

    const finalDriverId = updateData.driverId ?? sheet.driverId;
    if (dto.crew) {
      await validateSupportCrew(this.prisma, vendorId, dto.crew, finalDriverId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.crew) {
        await tx.dailySheetCrew.deleteMany({ where: { dailySheetId: sheetId } });
        if (dto.crew.length > 0) {
          await tx.dailySheetCrew.createMany({
            data: dto.crew.map((m) => ({ dailySheetId: sheetId, userId: m.userId, role: m.role })),
          });
        }
      } else if (updateData.driverId) {
        // New driver may have been in the supporting crew — remove the duplicate
        await tx.dailySheetCrew.deleteMany({
          where: { dailySheetId: sheetId, userId: finalDriverId },
        });
      }

      // Keep the Communication Center's denormalized inbox context in sync
      // (LOCKED §5.6). Display/filter data only — driver access checks always
      // resolve the sheet's current driver, never these columns.
      if (updateData.driverId || updateData.vanId) {
        await tx.conversation.updateMany({
          where: { dailySheetId: sheetId },
          data: {
            ...(updateData.driverId ? { driverId: updateData.driverId } : {}),
            ...(updateData.vanId ? { vanId: updateData.vanId } : {}),
          },
        });
      }

      // Any assignment change invalidates the previous confirmation — the
      // updated crew must be explicitly re-confirmed before trips start.
      return tx.dailySheet.update({
        where: { id: sheetId },
        data: {
          ...updateData,
          crewConfirmed: false,
          crewConfirmedAt: null,
          crewConfirmedById: null,
        },
        include: {
          driver: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          route: { select: { id: true, name: true } },
          crew: { include: { user: { select: { id: true, name: true, role: true } } } },
        },
      });
    });

    await this.audit.log({
      vendorId,
      action: 'SWAP_ASSIGNMENT',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: {
        after: {
          ...updateData,
          ...(dto.crew ? { crew: dto.crew } : {}),
          crewConfirmed: false,
        },
      },
    });

    return updated;
  }

  /**
   * Confirms the sheet's crew for the day. Trips cannot start until the crew
   * is confirmed; any later crew/driver change resets the confirmation.
   */
  async confirmCrew(vendorId: string, sheetId: string, user: AuthUser) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) throw new ConflictException('Cannot confirm crew on a closed sheet');

    const crewInclude = {
      driver: { select: { id: true, name: true } },
      crew: { include: { user: { select: { id: true, name: true, role: true } } } },
      crewConfirmedBy: { select: { id: true, name: true } },
    };

    if (sheet.crewConfirmed) {
      // Idempotent — return current state without overwriting the original confirmer
      return this.prisma.dailySheet.findFirst({
        where: { id: sheetId },
        include: crewInclude,
      });
    }

    const updated = await this.prisma.dailySheet.update({
      where: { id: sheetId },
      data: {
        crewConfirmed: true,
        crewConfirmedAt: new Date(),
        crewConfirmedById: user.userId,
      },
      include: crewInclude,
    });

    await this.audit.log({
      vendorId,
      action: 'CONFIRM_CREW',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: {
        after: {
          crewConfirmed: true,
          crewConfirmedBy: user.userId,
          driverId: updated.driverId,
          crew: updated.crew.map((c) => ({ userId: c.userId, role: c.role })),
        },
      },
    });

    return updated;
  }

  private static readonly MOVE_ELIGIBLE_STATUSES: DeliveryStatus[] = [
    'PENDING',
    'NOT_AVAILABLE',
    'RESCHEDULED',
  ];

  /**
   * Move one or more customers' pending/failed deliveries to a different
   * van's sheet (same date or a future date). This is an in-place mutation
   * of the existing DailySheetItem row (dailySheetId/sequence/status) — not
   * a copy-and-cancel — because DeliveryIssue/DamageCase/ConversationMessage
   * all reference the item by id, and analytics.service.ts's getDeliveries
   * counts CANCELLED as a missed delivery, which a cancelled-source-item
   * design would have permanently miscounted for moved customers.
   */
  async moveDeliveryItems(user: AuthUser, dto: MoveDeliveryItemsDto) {
    const vendorId = user.vendorId;

    const items = await this.prisma.dailySheetItem.findMany({
      where: { id: { in: dto.itemIds } },
      include: {
        dailySheet: {
          select: { id: true, vendorId: true, vanId: true, date: true, isClosed: true },
        },
        customer: { select: { id: true, name: true } },
      },
    });

    if (items.length !== dto.itemIds.length) {
      throw new NotFoundException('One or more delivery items not found');
    }
    for (const item of items) {
      if (item.dailySheet.vendorId !== vendorId) {
        throw new NotFoundException('One or more delivery items not found');
      }
    }
    for (const item of items) {
      if (!DailySheetService.MOVE_ELIGIBLE_STATUSES.includes(item.status)) {
        throw new ConflictException(
          `${item.customer.name}'s delivery is ${item.status} and cannot be moved`,
        );
      }
    }

    const destinationDate = new Date(dto.destinationDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (destinationDate < todayStart) {
      throw new BadRequestException('Cannot move to a past date');
    }

    const destinationVan = await this.prisma.van.findFirst({
      where: { id: dto.destinationVanId, vendorId, isActive: true },
    });
    if (!destinationVan) {
      throw new NotFoundException('Destination van not found');
    }

    const startOfDestDay = new Date(destinationDate);
    startOfDestDay.setHours(0, 0, 0, 0);
    const endOfDestDay = new Date(destinationDate);
    endOfDestDay.setHours(23, 59, 59, 999);

    for (const item of items) {
      const sameVan = item.dailySheet.vanId === dto.destinationVanId;
      const sameDay = item.dailySheet.date >= startOfDestDay && item.dailySheet.date <= endOfDestDay;
      if (sameVan && sameDay) {
        throw new ConflictException(
          `${item.customer.name} is already on this van's sheet for this date`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let ensured: { sheet: { id: string; isClosed: boolean }; createdNewSheet: boolean };
      try {
        ensured = await this.ensureSheetForVanDate(tx, vendorId, dto.destinationVanId, dto.destinationDate);
      } catch (err) {
        // Lost a concurrent race to create the same (vendorId, vanId, date) sheet —
        // the other transaction already committed it; fetch and use that one instead.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await tx.dailySheet.findFirst({
            where: { vendorId, vanId: dto.destinationVanId, date: { gte: startOfDestDay, lte: endOfDestDay } },
          });
          if (!existing) throw err;
          ensured = { sheet: existing, createdNewSheet: false };
        } else {
          throw err;
        }
      }

      if (ensured.sheet.isClosed) {
        throw new ConflictException('Cannot move to a closed sheet');
      }

      const destinationSheetId = ensured.sheet.id;

      const existingDestItems = await tx.dailySheetItem.findMany({
        where: {
          dailySheetId: destinationSheetId,
          status: { not: 'CANCELLED' },
          OR: items.map((i) => ({ customerId: i.customerId, productId: i.productId })),
        },
        select: { customerId: true, customer: { select: { name: true } } },
      });
      if (existingDestItems.length > 0) {
        const names = existingDestItems.map((i) => i.customer.name).join(', ');
        throw new ConflictException(
          `${names} already ${existingDestItems.length > 1 ? 'have' : 'has'} an active delivery on the destination sheet`,
        );
      }

      const maxSeq = await tx.dailySheetItem.aggregate({
        where: { dailySheetId: destinationSheetId },
        _max: { sequence: true },
      });
      let nextSequence = (maxSeq._max.sequence ?? 0) + 1;

      for (const item of items) {
        const before = {
          dailySheetId: item.dailySheetId,
          vanId: item.dailySheet.vanId,
          date: item.dailySheet.date,
          sequence: item.sequence,
          status: item.status,
        };

        const updated = await tx.dailySheetItem.update({
          where: { id: item.id },
          data: { dailySheetId: destinationSheetId, sequence: nextSequence, status: 'PENDING' },
        });
        nextSequence++;

        await this.audit.log({
          vendorId,
          userId: user.userId,
          userName: user.name,
          action: 'CUSTOMER_DELIVERY_MOVED',
          entity: 'DailySheetItem',
          entityId: item.id,
          changes: {
            before,
            after: {
              dailySheetId: destinationSheetId,
              vanId: dto.destinationVanId,
              date: dto.destinationDate,
              sequence: updated.sequence,
              status: updated.status,
            },
          },
        });
      }

      // Conversations move with their items — re-sync the denormalized inbox
      // context (sheet/van/driver/date) to the destination sheet (LOCKED §5.6
      // consistency rule; display/filter data only, never authorization).
      const destSheet = await tx.dailySheet.findUniqueOrThrow({
        where: { id: destinationSheetId },
        select: { vanId: true, driverId: true, date: true },
      });
      await tx.conversation.updateMany({
        where: { dailySheetItemId: { in: items.map((i) => i.id) } },
        data: {
          dailySheetId: destinationSheetId,
          vanId: destSheet.vanId,
          driverId: destSheet.driverId,
          deliveryDate: destSheet.date,
        },
      });

      return {
        destinationSheetId,
        createdNewSheet: ensured.createdNewSheet,
        movedCount: items.length,
      };
    });
  }

  /**
   * Per-van projection for the move-customer destination picker: which vans
   * already have a sheet for the given date (and whether it's closed), so
   * the frontend can show "will create new sheet" vs "adds to open sheet"
   * vs "unavailable (closed)" without N+1 requests.
   */
  async getDestinationOptions(vendorId: string, date: string) {
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const vans = await this.prisma.van.findMany({
      where: { vendorId, isActive: true },
      select: {
        id: true,
        plateNumber: true,
        defaultDriver: { select: { name: true } },
        dailySheets: {
          where: { date: { gte: startOfDay, lte: endOfDay } },
          select: { id: true, isClosed: true },
          take: 1,
        },
      },
    });

    return vans.map((van) => {
      const sheet = van.dailySheets[0];
      return {
        vanId: van.id,
        plateNumber: van.plateNumber,
        driverName: van.defaultDriver?.name ?? null,
        hasSheetForDate: !!sheet,
        sheetId: sheet?.id,
        isClosed: sheet?.isClosed ?? false,
      };
    });
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
        crew: {
          include: { user: { select: { id: true, name: true, role: true } } },
        },
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
