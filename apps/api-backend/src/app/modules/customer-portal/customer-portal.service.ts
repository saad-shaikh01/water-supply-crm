import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CustomerService } from '../customer/customer.service';

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
      deliveryDays: customer.deliveryDays,
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
      wallets: customer.wallets.map((w) => ({
        product: w.product,
        bottleBalance: w.balance,
        pricePerBottle:
          customer.customPrices.find((cp) => cp.productId === w.productId)
            ?.customPrice ?? w.product.basePrice,
      })),
    };
  }

  async getTransactions(userId: string, pagination: PaginationQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20 } = pagination;

    const where = { customerId: customer.id, vendorId: customer.vendorId };

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

  async getDeliveries(userId: string, pagination: PaginationQueryDto) {
    const customer = await this.getCustomer(userId);
    const { page = 1, limit = 20 } = pagination;

    const where = { customerId: customer.id };

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
}
