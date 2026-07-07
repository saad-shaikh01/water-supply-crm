import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { NotificationType } from '@prisma/client';
import { QUEUE_NAMES, JOB_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { NotificationService } from '../notifications/notification.service';
import { FcmService } from '../fcm/fcm.service';
import { MessageTemplates } from '../whatsapp/templates/message.templates';

@Processor(QUEUE_NAMES.ORDER_DISPATCH)
export class AutoDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoDispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly fcm: FcmService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.AUTO_DISPATCH_ORDER) return;

    const { orderId, vendorId } = job.data as { orderId: string; vendorId: string };
    this.logger.log(`Auto-dispatching order ${orderId} for vendor ${vendorId}`);

    const order = await this.prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          select: {
            name: true,
            phoneNumber: true,
            userId: true,
            deliverySchedules: { select: { vanId: true, dayOfWeek: true } },
          },
        },
        product: { select: { name: true } },
      },
    });

    if (!order || order.vendorId !== vendorId || order.status !== 'APPROVED') {
      this.logger.warn(`Order ${orderId} not found, wrong vendor, or not APPROVED — skipping`);
      return;
    }

    if (order.dispatchStatus !== 'UNPLANNED') {
      this.logger.log(`Order ${orderId} already dispatched (${order.dispatchStatus}) — skipping`);
      return;
    }

    const schedules = order.customer.deliverySchedules;
    if (schedules.length === 0) {
      this.logger.log(`Customer ${order.customerId} has no delivery schedule — leaving as UNPLANNED`);
      return;
    }

    // Find the next delivery date across all scheduled days (starting from today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextSchedule = this.findNextSchedule(schedules, today);
    if (!nextSchedule) {
      this.logger.warn(`Could not resolve next delivery date for customer ${order.customerId}`);
      return;
    }

    const { targetDate, vanId } = nextSchedule;

    // Check if an open sheet already exists for this van+date
    const dayStart = new Date(targetDate);
    const dayEnd = new Date(targetDate);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const openSheet = await this.prisma.dailySheet.findFirst({
      where: {
        vendorId,
        vanId,
        date: { gte: dayStart, lt: dayEnd },
        isClosed: false,
      },
      include: { items: { select: { sequence: true } } },
    });

    if (openSheet) {
      const nextSequence = openSheet.items.length > 0
        ? Math.max(...openSheet.items.map((i) => i.sequence)) + 1
        : 1;

      await this.prisma.$transaction([
        this.prisma.dailySheetItem.create({
          data: {
            dailySheetId: openSheet.id,
            customerId: order.customerId,
            productId: order.productId,
            sequence: nextSequence,
            deliveryType: 'ON_DEMAND',
            sourceOrderId: order.id,
          },
        }),
        this.prisma.customerOrder.update({
          where: { id: orderId },
          data: {
            dispatchStatus: 'INSERTED_IN_SHEET',
            dispatchVanId: vanId,
            targetDate,
            dispatchMode: 'INSERT_IN_OPEN_SHEET',
            dispatchedAt: new Date(),
          },
        }),
      ]);

      this.logger.log(`Order ${orderId} inserted into sheet ${openSheet.id} (seq ${nextSequence})`);
      this.sendDispatchedNotifications(order, 'dispatched').catch((e) =>
        this.logger.warn(`Dispatch notification failed for order ${orderId}: ${e.message}`),
      );
    } else {
      await this.prisma.customerOrder.update({
        where: { id: orderId },
        data: {
          dispatchStatus: 'PLANNED',
          dispatchVanId: vanId,
          targetDate,
          dispatchMode: 'QUEUE_FOR_GENERATION',
          plannedAt: new Date(),
        },
      });

      this.logger.log(`Order ${orderId} planned for ${targetDate.toISOString().slice(0, 10)} on van ${vanId} (no open sheet)`);
      this.sendDispatchedNotifications(order, 'planned', targetDate).catch((e) =>
        this.logger.warn(`Planned notification failed for order ${orderId}: ${e.message}`),
      );
    }
  }

  private async sendDispatchedNotifications(
    order: any,
    mode: 'planned' | 'dispatched',
    targetDate?: Date,
  ): Promise<void> {
    const { customer, product, id: orderId, quantity } = order;
    if (!customer || !product) return;

    const productName = product.name;
    const qty = quantity;

    if (mode === 'planned' && targetDate) {
      const dateStr = targetDate.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });
      const waMsg = MessageTemplates.orderPlanned(customer.name, productName, qty, dateStr);
      const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_PLANNED}:${orderId}:wa`;
      await this.notifications.queueWhatsApp(customer.phoneNumber, waMsg, waKey, { vendorId: order.vendorId, type: NotificationType.ORDER_UPDATE });

      if (customer.userId) {
        const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_PLANNED}:${orderId}:fcm`;
        await this.notifications.queueFcm(
          customer.userId,
          'Delivery Scheduled 📅',
          `Your order for ${productName} is planned for ${dateStr}.`,
          { type: NOTIFICATION_EVENTS.ORDER_PLANNED, orderId },
          fcmKey,
          { vendorId: order.vendorId, type: NotificationType.ORDER_UPDATE },
        );
      }
    } else if (mode === 'dispatched') {
      const waMsg = MessageTemplates.orderDispatched(customer.name, productName, qty);
      const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_DISPATCHED}:${orderId}:wa`;
      await this.notifications.queueWhatsApp(customer.phoneNumber, waMsg, waKey, { vendorId: order.vendorId, type: NotificationType.ORDER_UPDATE });

      if (customer.userId) {
        const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_DISPATCHED}:${orderId}:fcm`;
        await this.notifications.queueFcm(
          customer.userId,
          'Order Out for Delivery 🚚',
          `Your ${productName} order is being delivered today!`,
          { type: NOTIFICATION_EVENTS.ORDER_DISPATCHED, orderId },
          fcmKey,
          { vendorId: order.vendorId, type: NotificationType.ORDER_UPDATE },
        );
      }
    }
  }

  private findNextSchedule(
    schedules: Array<{ vanId: string; dayOfWeek: number }>,
    from: Date,
  ): { targetDate: Date; vanId: string } | null {
    // dayOfWeek: 1=Mon…6=Sat. JS getDay(): 0=Sun,1=Mon…6=Sat
    const toJsDay = (d: number) => d % 7; // 6→6 (Sat), 1→1 (Mon), preserves

    let best: { targetDate: Date; vanId: string } | null = null;

    for (const sched of schedules) {
      const jsDay = toJsDay(sched.dayOfWeek);
      const fromDay = from.getDay();

      let daysAhead = (jsDay - fromDay + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // always at least next week's occurrence

      const candidate = new Date(from);
      candidate.setDate(from.getDate() + daysAhead);

      if (!best || candidate < best.targetDate) {
        best = { targetDate: candidate, vanId: sched.vanId };
      }
    }

    return best;
  }
}
