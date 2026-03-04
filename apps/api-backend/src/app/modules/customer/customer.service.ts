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

  /** Follow a Google Maps short URL and extract lat/lng from the resolved full URL */
  private async resolveGoogleMapsLatLng(url: string): Promise<{ latitude?: number; longitude?: number }> {
    try {
      // Only attempt resolution for known short URLs
      if (!url.includes('goo.gl') && !url.includes('maps.app')) return {};

      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      const finalUrl = res.url;

      // Try @lat,lng pattern
      const atMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (atMatch) return { latitude: parseFloat(atMatch[1]), longitude: parseFloat(atMatch[2]) };

      // Try ?q=lat,lng pattern
      const qMatch = finalUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (qMatch) return { latitude: parseFloat(qMatch[1]), longitude: parseFloat(qMatch[2]) };
    } catch {
      // Non-fatal — just skip lat/lng if resolution fails
    }
    return {};
  }

  private async generateCustomerCode(vendorId: string, tx: any): Promise<string> {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { name: true },
    });

    // Prefix: first letter of each word in vendor name, max 3 chars (e.g. "AquaPure Karachi" → "AK")
    const prefix = (vendor?.name ?? 'C')
      .split(/\s+/)
      .map((w: string) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 3) || 'C';

    // Find highest existing sequential code for this vendor
    const last = await tx.customer.findFirst({
      where: { vendorId, customerCode: { startsWith: `${prefix}-` } },
      orderBy: { customerCode: 'desc' },
      select: { customerCode: true },
    });

    let next = 1;
    if (last) {
      const num = parseInt(last.customerCode.split('-').pop() ?? '0', 10);
      if (!isNaN(num)) next = num + 1;
    }

    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  async create(vendorId: string, dto: CreateCustomerDto) {
    // If customerCode provided manually, check uniqueness
    if (dto.customerCode) {
      const existing = await this.prisma.customer.findUnique({
        where: { customerCode: dto.customerCode },
      });
      if (existing) throw new ConflictException('Customer code already exists');
    }

    // Resolve lat/lng from Google Maps URL if not explicitly provided
    let resolvedCoords: { latitude?: number; longitude?: number } = {};
    if (dto.googleMapsUrl && (dto.latitude == null || dto.longitude == null)) {
      resolvedCoords = await this.resolveGoogleMapsLatLng(dto.googleMapsUrl);
    }

    const { deliverySchedule, ...customerFields } = dto;

    const customer = await this.prisma.$transaction(async (tx) => {
      const customerCode = dto.customerCode ?? (await this.generateCustomerCode(vendorId, tx));

      const customer = await tx.customer.create({
        data: {
          ...customerFields,
          customerCode,
          vendorId,
          latitude: dto.latitude ?? resolvedCoords.latitude,
          longitude: dto.longitude ?? resolvedCoords.longitude,
        },
      });

      if (deliverySchedule?.length) {
        await tx.customerDeliverySchedule.createMany({
          data: deliverySchedule.map((s) => ({
            customerId: customer.id,
            vanId: s.vanId,
            dayOfWeek: s.dayOfWeek,
            routeSequence: s.routeSequence ?? null,
          })),
        });
      }

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
          deliverySchedules: {
            include: { van: { select: { id: true, plateNumber: true } } },
            orderBy: { dayOfWeek: 'asc' },
          },
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
        deliverySchedules: {
          include: { van: { select: { id: true, plateNumber: true } } },
          orderBy: { dayOfWeek: 'asc' },
        },
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

    // Resolve lat/lng from Google Maps URL if URL changed and coords not provided
    let resolvedCoords: { latitude?: number; longitude?: number } = {};
    if (dto.googleMapsUrl && dto.googleMapsUrl !== customer.googleMapsUrl && dto.latitude == null && dto.longitude == null) {
      resolvedCoords = await this.resolveGoogleMapsLatLng(dto.googleMapsUrl);
    }

    const { deliverySchedule, ...customerFields } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Replace schedule if provided (delete-then-recreate)
      if (deliverySchedule !== undefined) {
        await tx.customerDeliverySchedule.deleteMany({ where: { customerId: id } });
        if (deliverySchedule.length > 0) {
          await tx.customerDeliverySchedule.createMany({
            data: deliverySchedule.map((s) => ({
              customerId: id,
              vanId: s.vanId,
              dayOfWeek: s.dayOfWeek,
              routeSequence: s.routeSequence ?? null,
            })),
          });
        }
      }

      return tx.customer.update({
        where: { id },
        data: {
          ...customerFields,
          latitude: dto.latitude ?? resolvedCoords.latitude,
          longitude: dto.longitude ?? resolvedCoords.longitude,
        },
        include: {
          route: { select: { id: true, name: true } },
          wallets: { include: { product: { select: { id: true, name: true } } } },
          deliverySchedules: {
            include: { van: { select: { id: true, plateNumber: true } } },
            orderBy: { dayOfWeek: 'asc' },
          },
        },
      });
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

    // Subtract transactions that occurred AFTER the selected month so that
    // closingBalance reflects the balance at the END of the selected month,
    // not today's live balance.
    const laterTxs = await this.prisma.transaction.findMany({
      where: { customerId, vendorId, createdAt: { gte: endDate } },
      select: { amount: true },
    });
    const laterActivity = laterTxs.reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const closingBalance = customer.financialBalance - laterActivity;
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

    // Get customer's delivery schedules (convention: 1=Mon, ..., 7=Sun)
    const schedules = await this.prisma.customerDeliverySchedule.findMany({
      where: { customerId },
      select: { dayOfWeek: true, vanId: true },
    });
    const scheduledDays = new Set(schedules.map((s) => s.dayOfWeek));

    // Use UTC for consistent date range iteration
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Fetch actual delivery records for the date range
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

    // Map date string (YYYY-MM-DD) → actual status
    const actualStatus = new Map<string, string>();
    for (const item of sheetItems) {
      const dateStr = item.dailySheet.date.toISOString().slice(0, 10);
      actualStatus.set(dateStr, item.status);
    }

    // Build schedule by iterating each day in range using UTC methods
    const schedule: { date: string; dayName: string; status: string }[] = [];
    const current = new Date(fromDate);
    while (current <= toDate) {
      const utcDOW = current.getUTCDay();
      const dayOfWeek = utcDOW === 0 ? 7 : utcDOW; // Normalize Sunday (0 -> 7)
      
      if (scheduledDays.has(dayOfWeek)) {
        const dateStr = current.toISOString().slice(0, 10);
        schedule.push({
          date: dateStr,
          dayName: DAY_NAMES[utcDOW],
          status: actualStatus.get(dateStr) ?? 'SCHEDULED',
        });
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return schedule;
  }

  async getFinancialSummary(vendorId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [currentTxns, lastTxns, lastMonthItems, lastDelivery] = await Promise.all([
      // Current month transactions
      this.prisma.transaction.findMany({
        where: { customerId, vendorId, createdAt: { gte: currentMonthStart, lte: currentMonthEnd } },
        select: { type: true, amount: true },
      }),
      // Last month transactions
      this.prisma.transaction.findMany({
        where: { customerId, vendorId, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
        select: { type: true, amount: true },
      }),
      // Last month delivery items (for bottle count)
      this.prisma.dailySheetItem.findMany({
        where: {
          customerId,
          status: 'COMPLETED',
          dailySheet: { vendorId, date: { gte: lastMonthStart, lte: lastMonthEnd } },
        },
        select: { filledDropped: true, emptyReceived: true },
      }),
      // Most recent completed delivery
      this.prisma.dailySheetItem.findFirst({
        where: { customerId, status: 'COMPLETED', dailySheet: { vendorId } },
        orderBy: { createdAt: 'desc' },
        include: { dailySheet: { select: { date: true } } },
      }),
    ]);

    const sum = (txns: { type: string; amount: number }[], type: string) =>
      txns.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);

    const currentMonthDue = sum(currentTxns, 'DELIVERY');
    const currentMonthPaid = sum(currentTxns, 'PAYMENT');
    const lastMonthDue = sum(lastTxns, 'DELIVERY');
    const lastMonthPaid = sum(lastTxns, 'PAYMENT');
    const lastMonthBottles = lastMonthItems.reduce((acc, i) => acc + (i.filledDropped ?? 0), 0);

    return {
      currentMonth: {
        due: currentMonthDue,
        paid: currentMonthPaid,
        outstanding: currentMonthDue - currentMonthPaid,
      },
      lastMonth: {
        due: lastMonthDue,
        paid: lastMonthPaid,
        outstanding: lastMonthDue - lastMonthPaid,
        bottlesDelivered: lastMonthBottles,
      },
      lastDeliveryDate: lastDelivery?.dailySheet?.date ?? null,
      lastDeliveryBottles: lastDelivery?.filledDropped ?? 0,
      runningBalance: customer.financialBalance,
    };
  }
}
