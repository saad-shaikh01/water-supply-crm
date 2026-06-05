import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { DispatchStatus } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { CreateOrderDto } from './dto/create-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { DispatchPlanDto } from './dto/dispatch-plan.dto';
import { BulkApproveDto, BulkPlanDto } from './dto/bulk-order.dto';
import { NotificationService } from '../notifications/notification.service';
import { FcmService } from '../fcm/fcm.service';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { NOTIFICATION_EVENTS, QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private fcm: FcmService,
    private cache: CacheInvalidationService,
    @InjectQueue(QUEUE_NAMES.ORDER_DISPATCH) private dispatchQueue: Queue,
  ) {}

  private async getCustomer(userId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { userId } });
    if (!customer) throw new ForbiddenException('No customer account linked to this user');
    return customer;
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    const customer = await this.getCustomer(userId);

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId: customer.vendorId, isActive: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const order = await this.prisma.customerOrder.create({
      data: {
        vendorId: customer.vendorId,
        customerId: customer.id,
        productId: dto.productId,
        quantity: dto.quantity,
        note: dto.note ?? null,
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
      },
      include: {
        product: { select: { id: true, name: true, basePrice: true } },
      },
    });

    // Notify vendor staff of the new order (fire-and-forget)
    this.fcm
      .sendToVendorUsers(
        customer.vendorId,
        'New Order Received 🛒',
        `${customer.name} ordered ${order.product.name} × ${dto.quantity}.`,
        { type: NOTIFICATION_EVENTS.ORDER_SUBMITTED, orderId: order.id },
      )
      .catch((e: Error) => this.logger.warn(`FCM order-submitted failed for vendor ${customer.vendorId}: ${e.message}`));

    return order;
  }

  async getCustomerOrders(userId: string, query: OrderQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20, status } = query;

    const where: any = { customerId: customer.id };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, basePrice: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerOrder.count({ where }),
    ]);

    const data = orders.map((order) => ({
      ...order,
      fulfillmentStatus: this.resolveFulfillmentStatus(order.status, order.dispatchStatus),
      plannedDate: order.targetDate ?? null,
      deliveredAt: order.dispatchedAt ?? null,
      dispatchContext:
        order.dispatchStatus !== 'UNPLANNED'
          ? {
              vanId: order.dispatchVanId ?? null,
              driverId: order.dispatchDriverId ?? null,
              targetDate: order.targetDate ?? null,
              dispatchMode: order.dispatchMode ?? null,
            }
          : null,
    }));

    return paginate(data, total, page, limit);
  }

  private resolveFulfillmentStatus(
    status: string,
    dispatchStatus: string,
  ): string {
    if (status === 'PENDING') return 'PENDING_APPROVAL';
    if (status === 'REJECTED') return 'REJECTED';
    if (status === 'CANCELLED') return 'CANCELLED';
    // APPROVED — check dispatch sub-state
    switch (dispatchStatus) {
      case 'PLANNED': return 'PLANNED';
      case 'INSERTED_IN_SHEET': return 'OUT_FOR_DELIVERY';
      case 'DELIVERED': return 'DELIVERED';
      case 'FAILED': return 'APPROVED'; // reattempt pending
      case 'SELF_PICKUP_DONE': return 'DELIVERED';
      default: return 'APPROVED';
    }
  }

  async cancelOrder(userId: string, orderId: string) {
    const customer = await this.getCustomer(userId);
    const order = await this.prisma.customerOrder.findUnique({ where: { id: orderId } });

    if (!order || order.customerId !== customer.id) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new BadRequestException('Only PENDING orders can be cancelled');

    const updated = await this.prisma.customerOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    // Notify vendor staff that a pending order was cancelled (fire-and-forget)
    this.fcm
      .sendToVendorUsers(
        customer.vendorId,
        'Order Cancelled ❌',
        `${customer.name} cancelled their order (ID: ${orderId}).`,
        { type: NOTIFICATION_EVENTS.ORDER_CANCELLED, orderId },
      )
      .catch((e: Error) => this.logger.warn(`FCM order-cancelled failed for vendor ${customer.vendorId}: ${e.message}`));

    return updated;
  }

  async getVendorOrders(vendorId: string, query: OrderQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      customerId,
      productId,
      dateFrom,
      dateTo,
    } = query;
    const where: any = { vendorId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phoneNumber: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { note: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (dateFrom || dateTo) {
      const createdAt: any = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        createdAt.lte = endOfDay;
      }
      where.createdAt = createdAt;
    }

    const [data, total] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true } },
          product: { select: { id: true, name: true, basePrice: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerOrder.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async approveOrder(vendorId: string, orderId: string, reviewerId: string) {
    const order = await this.prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { name: true, phoneNumber: true, userId: true } },
        product: { select: { name: true } },
      },
    });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not in PENDING status');

    const updated = await this.prisma.customerOrder.update({
      where: { id: orderId },
      data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
    });

    // Notify customer — WhatsApp + FCM
    const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${orderId}:wa`;
    const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${orderId}:fcm`;

    const waMsg = MessageTemplates.orderApproved(
      order.customer.name,
      order.product.name,
      order.quantity,
    );
    this.notifications
      .queueWhatsApp(order.customer.phoneNumber, waMsg, waKey)
      .catch((e) => this.logger.warn(`WhatsApp notify failed for order ${orderId}: ${e.message}`));

    if (order.customer.userId) {
      this.notifications
        .queueFcm(
          order.customer.userId,
          'Order Approved ✅',
          `Your order for ${order.product.name} (qty: ${order.quantity}) has been approved.`,
          { type: 'ORDER_APPROVED', orderId },
          fcmKey,
        )
        .catch((e: Error) => this.logger.warn(`FCM order-approved failed for user ${order.customer.userId}: ${e.message}`));
    }

    await this.cache.invalidateOverview(vendorId);

    // Enqueue auto-dispatch (fire-and-forget — failure doesn't block approval)
    this.dispatchQueue
      .add(JOB_NAMES.AUTO_DISPATCH_ORDER, { orderId, vendorId }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      .catch((e: Error) => this.logger.warn(`Auto-dispatch queue failed for order ${orderId}: ${e.message}`));

    return updated;
  }

  async rejectOrder(vendorId: string, orderId: string, reviewerId: string, dto: RejectOrderDto) {
    const order = await this.prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { name: true, phoneNumber: true, userId: true } },
        product: { select: { name: true } },
      },
    });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not in PENDING status');

    const updated = await this.prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: 'REJECTED',
        rejectionReason: dto.rejectionReason,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    // Notify customer — WhatsApp + FCM
    const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_REJECTED}:${orderId}:wa`;
    const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_REJECTED}:${orderId}:fcm`;

    const waMsg = MessageTemplates.orderRejected(
      order.customer.name,
      order.product.name,
      dto.rejectionReason,
    );
    this.notifications
      .queueWhatsApp(order.customer.phoneNumber, waMsg, waKey)
      .catch((e) => this.logger.warn(`WhatsApp notify failed for order ${orderId}: ${e.message}`));

    if (order.customer.userId) {
      this.notifications
        .queueFcm(
          order.customer.userId,
          'Order Rejected ❌',
          `Your order for ${order.product.name} was rejected.${dto.rejectionReason ? ` Reason: ${dto.rejectionReason}` : ''}`,
          { type: 'ORDER_REJECTED', orderId },
          fcmKey,
        )
        .catch((e: Error) => this.logger.warn(`FCM order-rejected failed for user ${order.customer.userId}: ${e.message}`));
    }

    return updated;
  }

  private validateTargetDate(targetDate: string): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(targetDate) < today) {
      throw new BadRequestException('Delivery date cannot be in the past.');
    }
  }

  private async getApprovedOrder(vendorId: string, orderId: string) {
    const order = await this.prisma.customerOrder.findUnique({ where: { id: orderId } });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED orders can be dispatch-planned');
    }
    return order;
  }

  async createDispatchPlan(vendorId: string, orderId: string, dto: DispatchPlanDto, userId: string) {
    const order = await this.getApprovedOrder(vendorId, orderId);
    this.validateTargetDate(dto.targetDate);
    if (order.dispatchStatus !== DispatchStatus.UNPLANNED) {
      throw new BadRequestException('Dispatch plan already exists. Use PATCH to update.');
    }

    const updated = await this.prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        dispatchStatus: DispatchStatus.PLANNED,
        targetDate: new Date(dto.targetDate),
        timeWindow: dto.timeWindow ?? null,
        dispatchVanId: dto.vanId ?? null,
        dispatchDriverId: dto.driverId ?? null,
        dispatchMode: dto.dispatchMode,
        dispatchNotes: dto.notes ?? null,
        plannedAt: new Date(),
        plannedById: userId,
      },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true, userId: true } },
        product: { select: { id: true, name: true } },
      },
    });

    this.sendPlanNotification(orderId, updated.customer, updated.product.name, updated.quantity, new Date(dto.targetDate));

    return updated;
  }

  async updateDispatchPlan(vendorId: string, orderId: string, dto: DispatchPlanDto, userId: string) {
    const order = await this.getApprovedOrder(vendorId, orderId);
    this.validateTargetDate(dto.targetDate);
    if (order.dispatchStatus === DispatchStatus.UNPLANNED) {
      throw new BadRequestException('No dispatch plan exists yet. Use POST to create.');
    }
    if (order.dispatchStatus === DispatchStatus.INSERTED_IN_SHEET) {
      throw new BadRequestException('Order is already inserted in a sheet and cannot be re-planned');
    }

    const updated = await this.prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        dispatchStatus: DispatchStatus.PLANNED,
        targetDate: new Date(dto.targetDate),
        timeWindow: dto.timeWindow ?? null,
        dispatchVanId: dto.vanId ?? null,
        dispatchDriverId: dto.driverId ?? null,
        dispatchMode: dto.dispatchMode,
        dispatchNotes: dto.notes ?? null,
        plannedAt: new Date(),
        plannedById: userId,
      },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true, userId: true } },
        product: { select: { id: true, name: true } },
      },
    });

    this.sendPlanNotification(orderId, updated.customer, updated.product.name, updated.quantity, new Date(dto.targetDate));

    return updated;
  }

  async bulkApprove(vendorId: string, dto: BulkApproveDto, reviewerId: string) {
    const orders = await this.prisma.customerOrder.findMany({
      where: { id: { in: dto.orderIds }, vendorId, status: 'PENDING' },
      include: {
        customer: { select: { name: true, phoneNumber: true, userId: true } },
        product: { select: { name: true } },
      },
    });

    if (orders.length === 0) return { approved: 0, skipped: dto.orderIds.length };

    const approvedIds = orders.map((o) => o.id);

    await this.prisma.customerOrder.updateMany({
      where: { id: { in: approvedIds } },
      data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
    });

    // Fire-and-forget: notify customers + enqueue auto-dispatch for each
    for (const order of orders) {
      const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${order.id}:wa`;
      const waMsg = MessageTemplates.orderApproved(order.customer.name, order.product.name, order.quantity);
      this.notifications.queueWhatsApp(order.customer.phoneNumber, waMsg, waKey).catch(() => null);

      if (order.customer.userId) {
        const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_APPROVED}:${order.id}:fcm`;
        this.notifications.queueFcm(
          order.customer.userId,
          'Order Approved ✅',
          `Your order for ${order.product.name} has been approved.`,
          { type: 'ORDER_APPROVED', orderId: order.id },
          fcmKey,
        ).catch(() => null);
      }

      this.dispatchQueue
        .add(JOB_NAMES.AUTO_DISPATCH_ORDER, { orderId: order.id, vendorId }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
        .catch(() => null);
    }

    await this.cache.invalidateOverview(vendorId);

    return { approved: approvedIds.length, skipped: dto.orderIds.length - approvedIds.length };
  }

  async bulkPlan(vendorId: string, dto: BulkPlanDto, reviewerId: string) {
    const targetDate = new Date(dto.targetDate);
    this.validateTargetDate(dto.targetDate);
    const orders = await this.prisma.customerOrder.findMany({
      where: {
        id: { in: dto.orderIds },
        vendorId,
        status: 'APPROVED',
        dispatchStatus: { in: ['UNPLANNED', 'PLANNED'] },
      },
      include: {
        customer: { select: { name: true, phoneNumber: true, userId: true } },
        product: { select: { name: true } },
      },
    });

    if (orders.length === 0) return { planned: 0, skipped: dto.orderIds.length };

    const plannedIds = orders.map((o) => o.id);

    await this.prisma.customerOrder.updateMany({
      where: { id: { in: plannedIds } },
      data: {
        dispatchStatus: DispatchStatus.PLANNED,
        targetDate,
        dispatchMode: 'QUEUE_FOR_GENERATION',
        plannedAt: new Date(),
        plannedById: reviewerId,
      },
    });

    for (const order of orders) {
      this.sendPlanNotification(order.id, order.customer, order.product.name, order.quantity, targetDate);
    }

    return { planned: plannedIds.length, skipped: dto.orderIds.length - plannedIds.length };
  }

  private sendPlanNotification(
    orderId: string,
    customer: { name: string; phoneNumber: string; userId: string | null },
    productName: string,
    qty: number,
    targetDate: Date,
  ) {
    const dateStr = targetDate.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });
    const waMsg = MessageTemplates.orderPlanned(customer.name, productName, qty, dateStr);
    const waKey = `ntf:${NOTIFICATION_EVENTS.ORDER_PLANNED}:${orderId}:wa`;

    this.notifications
      .queueWhatsApp(customer.phoneNumber, waMsg, waKey)
      .catch((e) => this.logger.warn(`WhatsApp plan-notify failed for order ${orderId}: ${e.message}`));

    if (customer.userId) {
      const fcmKey = `ntf:${NOTIFICATION_EVENTS.ORDER_PLANNED}:${orderId}:fcm`;
      this.notifications
        .queueFcm(
          customer.userId,
          'Delivery Scheduled 📅',
          `Your order for ${productName} is planned for ${dateStr}.`,
          { type: NOTIFICATION_EVENTS.ORDER_PLANNED, orderId },
          fcmKey,
        )
        .catch((e: Error) => this.logger.warn(`FCM plan-notify failed for order ${orderId}: ${e.message}`));
    }
  }

  async dispatchNow(vendorId: string, orderId: string, userId: string) {
    const order = await this.getApprovedOrder(vendorId, orderId);

    return this.prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        dispatchStatus: DispatchStatus.INSERTED_IN_SHEET,
        dispatchedAt: new Date(),
        plannedById: userId,
      },
      include: {
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });
  }
}
