import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { CreateOrderDto } from './dto/create-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

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

    const [data, total] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where,
        include: { product: { select: { id: true, name: true, basePrice: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customerOrder.count({ where }),
    ]);

    return paginate(data, total, page, limit);
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
    const order = await this.prisma.customerOrder.findUnique({ where: { id: orderId } });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not in PENDING status');

    return this.prisma.customerOrder.update({
      where: { id: orderId },
      data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  async rejectOrder(vendorId: string, orderId: string, reviewerId: string, dto: RejectOrderDto) {
    const order = await this.prisma.customerOrder.findUnique({ where: { id: orderId } });
    if (!order || order.vendorId !== vendorId) throw new NotFoundException('Order not found');
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not in PENDING status');

    return this.prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: 'REJECTED',
        rejectionReason: dto.rejectionReason,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }
}
