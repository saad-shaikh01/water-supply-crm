import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { DispatchStatus } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { CreateOrderDto } from './dto/create-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { DispatchPlanDto } from './dto/dispatch-plan.dto';
import { NotificationService } from '../notifications/notification.service';
import { NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
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

    return this.prisma.customerOrder.create({
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

    return this.prisma.customerOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }

  async getVendorOrders(vendorId: string, query: OrderQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const where: any = { vendorId };
    if (status) where.status = status;

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
        .catch(() => null);
    }

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
        .catch(() => null);
    }

    return updated;
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
    if (order.dispatchStatus !== DispatchStatus.UNPLANNED) {
      throw new BadRequestException('Dispatch plan already exists. Use PATCH to update.');
    }

    return this.prisma.customerOrder.update({
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
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });
  }

  async updateDispatchPlan(vendorId: string, orderId: string, dto: DispatchPlanDto, userId: string) {
    const order = await this.getApprovedOrder(vendorId, orderId);
    if (order.dispatchStatus === DispatchStatus.UNPLANNED) {
      throw new BadRequestException('No dispatch plan exists yet. Use POST to create.');
    }
    if (order.dispatchStatus === DispatchStatus.INSERTED_IN_SHEET) {
      throw new BadRequestException('Order is already inserted in a sheet and cannot be re-planned');
    }

    return this.prisma.customerOrder.update({
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
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });
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
