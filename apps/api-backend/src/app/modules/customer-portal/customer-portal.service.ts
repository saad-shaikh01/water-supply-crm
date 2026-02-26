import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { CustomerService } from '../customer/customer.service';
import { PortalDeliveriesQueryDto } from './dto/portal-deliveries-query.dto';
import { PortalTransactionsQueryDto } from './dto/portal-transactions-query.dto';

@Injectable()
export class CustomerPortalService {
  constructor(
    private prisma: PrismaService,
    private customerService: CustomerService,
  ) {}

  private async getCustomer(userId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { userId },
    });
    if (!customer) {
      throw new ForbiddenException('No customer account linked to this user');
    }
    return customer;
  }

  async getProfile(userId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { userId },
      include: {
        route: { select: { id: true, name: true } },
        wallets: {
          include: { product: { select: { id: true, name: true } } },
        },
        customPrices: {
          include: { product: { select: { id: true, name: true } } },
        },
        deliverySchedules: {
          include: { van: { select: { id: true, plateNumber: true } } },
          orderBy: { dayOfWeek: 'asc' },
        },
        user: { select: { email: true } },
      },
    });

    if (!customer) {
      throw new ForbiddenException('No customer account linked to this user');
    }

    return {
      id: customer.id,
      customerCode: customer.customerCode,
      name: customer.name,
      address: customer.address,
      phoneNumber: customer.phoneNumber,
      email: customer.user?.email ?? null,
      paymentType: customer.paymentType,
      floor: customer.floor ?? null,
      nearbyLandmark: customer.nearbyLandmark ?? null,
      deliveryInstructions: customer.deliveryInstructions ?? null,
      createdAt: customer.createdAt,
      deliverySchedules: customer.deliverySchedules,
      financialBalance: customer.financialBalance,
      route: customer.route,
      wallets: customer.wallets,
      customPrices: customer.customPrices,
    };
  }

  /** Returns vendor's payment info (Raast ID, name) for manual payment instructions */
  async getVendorPaymentInfo(userId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { userId },
      include: {
        vendor: { select: { id: true, name: true, raastId: true } },
      },
    });
    if (!customer) throw new ForbiddenException('No customer account linked');

    return {
      vendorName: customer.vendor.name,
      raastId: customer.vendor.raastId ?? null,
      instructions: customer.vendor.raastId
        ? `Send payment to Raast ID: ${customer.vendor.raastId}\nThen submit your reference number in the app.`
        : 'Please contact your vendor for payment instructions.',
    };
  }

  async getBalance(userId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { userId },
      include: {
        wallets: {
          include: {
            product: { select: { id: true, name: true, basePrice: true } },
          },
        },
        customPrices: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });

    if (!customer) {
      throw new ForbiddenException('No customer account linked to this user');
    }

    return {
      financialBalance: customer.financialBalance,
      bottleWallets: customer.wallets.map((w) => ({
        productId: w.productId,
        product: { name: w.product.name },
        quantity: w.balance,
        effectivePrice:
          customer.customPrices.find((cp) => cp.productId === w.productId)
            ?.customPrice ?? w.product.basePrice,
      })),
    };
  }

  async getSummary(userId: string) {
    const customer = await this.getCustomer(userId);

    const [totalPaidResult, lastPayment, schedules] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { customerId: customer.id, type: 'PAYMENT' },
        _sum: { amount: true },
      }),
      this.prisma.paymentRequest.findFirst({
        where: {
          customerId: customer.id,
          status: { in: ['PAID', 'APPROVED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.customerDeliverySchedule.findMany({
        where: { customerId: customer.id },
      }),
    ]);

    const scheduledDays = schedules.map((s) => s.dayOfWeek);
    const today = new Date();
    let nextDeliveryDate: Date | null = null;
    for (let i = 1; i <= 7; i++) {
      const next = new Date(today);
      next.setDate(today.getDate() + i);
      const dow = next.getDay() === 0 ? 7 : next.getDay();
      if (scheduledDays.includes(dow)) {
        nextDeliveryDate = next;
        break;
      }
    }

    return {
      totalPaid: totalPaidResult._sum.amount ?? 0,
      lastPaymentAmount: lastPayment?.amount ?? null,
      lastPaymentDate: lastPayment?.createdAt ?? null,
      nextDeliveryDate,
    };
  }

  async getTransactions(userId: string, query: PortalTransactionsQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20, type, dateFrom, dateTo, search } = query;

    const where: any = { customerId: customer.id, vendorId: customer.vendorId };
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (search) {
      where.description = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getDeliveries(userId: string, query: PortalDeliveriesQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20, dateFrom, dateTo } = query;

    const where: any = {
      customerId: customer.id,
      ...(dateFrom || dateTo
        ? {
            dailySheet: {
              date: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          dailySheet: {
            select: {
              id: true,
              date: true,
              isClosed: true,
              driver: { select: { id: true, name: true } },
              van: { select: { id: true, plateNumber: true } },
            },
          },
        },
        orderBy: { dailySheet: { date: 'desc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dailySheetItem.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getStatement(userId: string, month?: string): Promise<Buffer> {
    const customer = await this.getCustomer(userId);
    return this.customerService.getMonthlyStatementPdf(
      customer.vendorId,
      customer.id,
      month,
    );
  }

  async getSchedule(userId: string, from: string, to: string) {
    const customer = await this.getCustomer(userId);
    return this.customerService.getDeliverySchedule(
      customer.vendorId,
      customer.id,
      from,
      to,
    );
  }

  async getProducts(userId: string) {
    const customer = await this.getCustomer(userId);
    return this.prisma.product.findMany({
      where: { vendorId: customer.vendorId, isActive: true },
      select: { id: true, name: true, basePrice: true },
      orderBy: { name: 'asc' },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid)
      throw new BadRequestException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });

    return { message: 'Password updated successfully' };
  }
}
