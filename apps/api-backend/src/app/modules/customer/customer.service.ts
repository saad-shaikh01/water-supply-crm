import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import { CreatePortalAccountDto } from './dto/create-portal-account.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import { AuditService } from '../audit/audit.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private statementPdf: CustomerStatementPdfService,
    private audit: AuditService,
  ) {}

  async create(vendorId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { customerCode: dto.customerCode },
    });

    if (existing) {
      throw new ConflictException('Customer code already exists');
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { ...dto, vendorId },
      });

      const products = await tx.product.findMany({
        where: { vendorId, isActive: true },
      });

      for (const product of products) {
        await tx.bottleWallet.create({
          data: {
            customerId: customer.id,
            productId: product.id,
            balance: 0,
          },
        });
      }

      return customer;
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({
      vendorId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      changes: { after: { name: customer.name, customerCode: customer.customerCode } },
    });

    return customer;
  }

  async findAllPaginated(vendorId: string, query: CustomerQueryDto) {
    const { page = 1, limit = 20, search, routeId, paymentType, isActive, balanceMin, balanceMax, sort = 'name', sortDir = 'asc' } = query;

    // Default: show only active customers unless explicitly asked for inactive
    const where: any = { vendorId, isActive: isActive !== undefined ? isActive : true };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customerCode: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
      ];
    }

    if (routeId) {
      where.routeId = routeId;
    }

    if (paymentType) {
      where.paymentType = paymentType;
    }

    if (balanceMin !== undefined || balanceMax !== undefined) {
      where.financialBalance = {};
      if (balanceMin !== undefined) where.financialBalance.gte = balanceMin;
      if (balanceMax !== undefined) where.financialBalance.lte = balanceMax;
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          route: { select: { id: true, name: true } },
          wallets: { include: { product: { select: { id: true, name: true } } } },
        },
        orderBy: { [sort]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
      include: {
        route: true,
        wallets: { include: { product: true } },
        customPrices: { include: { product: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async update(vendorId: string, id: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
      include: {
        route: { select: { id: true, name: true } },
        wallets: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({
      vendorId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: id,
    });

    return updated;
  }

  async remove(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
      include: { _count: { select: { transactions: true } } },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer._count.transactions > 0) {
      throw new ConflictException(
        'Cannot delete customer with transaction history. Deactivate instead.',
      );
    }

    await this.prisma.customer.delete({ where: { id } });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({
      vendorId,
      action: 'DELETE',
      entity: 'Customer',
      entityId: id,
    });

    return { deleted: true };
  }

  async setCustomPrice(vendorId: string, customerId: string, dto: SetCustomPriceDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const result = await this.prisma.customerProductPrice.upsert({
      where: {
        customerId_productId: {
          customerId,
          productId: dto.productId,
        },
      },
      create: {
        customerId,
        productId: dto.productId,
        customPrice: dto.price,
      },
      update: {
        customPrice: dto.price,
      },
      include: { product: true },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return result;
  }

  async removeCustomPrice(vendorId: string, customerId: string, productId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.customerProductPrice.delete({
      where: {
        customerId_productId: {
          customerId,
          productId,
        },
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return { deleted: true };
  }

  async createPortalAccount(
    vendorId: string,
    customerId: string,
    dto: CreatePortalAccountDto,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.userId) {
      throw new ConflictException('Customer already has a portal account');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: customer.name,
        phoneNumber: customer.phoneNumber,
        role: 'CUSTOMER',
      },
      select: { id: true, email: true, name: true, phoneNumber: true, role: true, createdAt: true },
    });

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { userId: user.id },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return { message: 'Portal account created', user };
  }

  async removePortalAccount(vendorId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (!customer.userId) {
      throw new NotFoundException('Customer has no portal account');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { userId: null },
    });
    await this.prisma.user.delete({ where: { id: customer.userId } });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    return { message: 'Portal account removed' };
  }

  async getTransactionHistory(
    vendorId: string,
    customerId: string,
    pagination: PaginationQueryDto,
  ) {
    const { page = 1, limit = 20 } = pagination;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const where = { customerId, vendorId };

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

  async getMonthlyStatement(vendorId: string, customerId: string, month?: string) {
    const targetMonth = month ?? new Date().toISOString().slice(0, 7);
    const [year, mon] = targetMonth.split('-').map(Number);
    const startDate = new Date(year, mon - 1, 1);
    const endDate = new Date(year, mon, 1); // exclusive

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const transactions = await this.prisma.transaction.findMany({
      where: {
        customerId,
        vendorId,
        createdAt: { gte: startDate, lt: endDate },
      },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const periodActivity = transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const closingBalance = customer.financialBalance;
    const openingBalance = closingBalance - periodActivity;

    const period = new Date(year, mon - 1, 1).toLocaleString('en-PK', {
      month: 'long',
      year: 'numeric',
    });

    return {
      customer,
      transactions,
      openingBalance,
      closingBalance,
      period,
    };
  }

  async getMonthlyStatementPdf(vendorId: string, customerId: string, month?: string): Promise<Buffer> {
    const data = await this.getMonthlyStatement(vendorId, customerId, month);
    return this.statementPdf.generate(data);
  }

  async deactivate(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, vendorId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, customerCode: true, isActive: true },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    await this.audit.log({ vendorId, action: 'DEACTIVATE', entity: 'Customer', entityId: id });
    return updated;
  }

  async reactivate(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, vendorId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, name: true, customerCode: true, isActive: true },
    });
    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
    await this.audit.log({ vendorId, action: 'REACTIVATE', entity: 'Customer', entityId: id });
    return updated;
  }

  async getConsumptionStats(vendorId: string, customerId: string, month?: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      include: {
        wallets: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const targetMonth = month ?? new Date().toISOString().slice(0, 7);
    const [year, mon] = targetMonth.split('-').map(Number);
    const startDate = new Date(year, mon - 1, 1);
    const endDate = new Date(year, mon, 1);

    const deliveries = await this.prisma.transaction.findMany({
      where: {
        customerId,
        vendorId,
        type: 'DELIVERY',
        createdAt: { gte: startDate, lt: endDate },
      },
      select: {
        filledDropped: true,
        emptyReceived: true,
        createdAt: true,
        product: { select: { id: true, name: true } },
      },
    });

    const deliveryCount = deliveries.length;
    const totalFilled = deliveries.reduce((sum, t) => sum + (t.filledDropped ?? 0), 0);
    const totalEmpty = deliveries.reduce((sum, t) => sum + (t.emptyReceived ?? 0), 0);
    const avgPerDelivery = deliveryCount > 0
      ? Math.round((totalFilled / deliveryCount) * 100) / 100
      : 0;

    // Per-wallet consumption rate: avgPerDelivery / walletBalance * 100
    const walletStats = customer.wallets.map((w) => {
      const walletDeliveries = deliveries.filter((d) => d.product?.id === w.productId);
      const walletFilled = walletDeliveries.reduce((sum, d) => sum + (d.filledDropped ?? 0), 0);
      const walletAvg = walletDeliveries.length > 0
        ? Math.round((walletFilled / walletDeliveries.length) * 100) / 100
        : 0;
      const consumptionRate = w.balance > 0
        ? Math.round((walletAvg / w.balance) * 10000) / 100
        : null;

      return {
        product: w.product,
        currentWalletBalance: w.balance,
        deliveryCount: walletDeliveries.length,
        totalConsumed: walletFilled,
        avgPerDelivery: walletAvg,
        consumptionRate: consumptionRate !== null ? `${consumptionRate}%` : 'N/A',
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      period: targetMonth,
      summary: {
        deliveryCount,
        totalFilledDropped: totalFilled,
        totalEmptyReceived: totalEmpty,
        avgFilledPerDelivery: avgPerDelivery,
      },
      byProduct: walletStats,
    };
  }

  async getDeliverySchedule(
    vendorId: string,
    customerId: string,
    from: string,
    to: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Fetch actual delivery records for past dates
    const sheetItems = await this.prisma.dailySheetItem.findMany({
      where: {
        customerId,
        dailySheet: {
          vendorId,
          date: { gte: fromDate, lte: toDate },
        },
      },
      include: {
        dailySheet: { select: { date: true } },
      },
    });

    // Map date string → actual status
    const actualStatus = new Map<string, string>();
    for (const item of sheetItems) {
      const dateStr = item.dailySheet.date.toISOString().slice(0, 10);
      actualStatus.set(dateStr, item.status);
    }

    // Build schedule by iterating each day in range
    const schedule: { date: string; dayName: string; status: string }[] = [];
    const current = new Date(fromDate);
    while (current <= toDate) {
      const dayOfWeek = current.getDay();
      if (customer.deliveryDays.includes(dayOfWeek)) {
        const dateStr = current.toISOString().slice(0, 10);
        schedule.push({
          date: dateStr,
          dayName: DAY_NAMES[dayOfWeek],
          status: actualStatus.get(dateStr) ?? 'SCHEDULED',
        });
      }
      current.setDate(current.getDate() + 1);
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      deliveryDays: customer.deliveryDays,
      schedule,
    };
  }
}
