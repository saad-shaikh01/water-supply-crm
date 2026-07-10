import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { DamageCaseStatus, DamageCaseType, Prisma } from '@prisma/client';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { SetCustomPriceDto } from './dto/set-custom-price.dto';
import {
  BulkPriceFiltersDto,
  BulkPriceUpdateDto,
} from './dto/bulk-price-update.dto';
import { BulkScheduleUpdateDto } from './dto/bulk-schedule-update.dto';
import { CreatePortalAccountDto } from './dto/create-portal-account.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';
import { CustomerStatementPdfService } from './pdf/customer-statement-pdf.service';
import { AuditService } from '../audit/audit.service';
import { ConsumptionQueryDto } from './dto/consumption-query.dto';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private statementPdf: CustomerStatementPdfService,
    private audit: AuditService,
    @InjectQueue(QUEUE_NAMES.BULK_PRICE_UPDATE)
    private bulkPriceQueue: Queue,
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

  private async generateCustomerCode(vendorId: string, tx: Prisma.TransactionClient): Promise<string> {
    // Use raw SQL to get the max numeric value from L#### codes — avoids string sort issues
    const result = await tx.$queryRaw<{ maxnum: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("customerCode", 2) AS INTEGER)) as maxnum
      FROM "Customer"
      WHERE "vendorId" = ${vendorId} AND "customerCode" ~ '^L[0-9]+$'
    `;
    const maxNum = result[0]?.maxnum ?? 0;
    return `L${maxNum + 1}`;
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

    const { deliverySchedule, defaultProductId, defaultPrice, ...customerFields } = dto;

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

      if (defaultProductId !== undefined && defaultPrice !== undefined) {
        await tx.customerProductPrice.upsert({
          where: { customerId_productId: { customerId: customer.id, productId: defaultProductId } },
          create: { customerId: customer.id, productId: defaultProductId, customPrice: defaultPrice },
          update: { customPrice: defaultPrice },
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
    const { page = 1, limit = 20, search, routeId, paymentType, vanId, dayOfWeek, isActive, balanceMin, balanceMax, sort = 'name', sortDir = 'asc' } = query;

    // Filter by status only when explicitly requested. When no isActive param is
    // sent (the "All Status" option in the UI), return both active and inactive
    // so the list count matches reality instead of silently hiding inactive ones.
    const where: any = { vendorId };
    if (isActive !== undefined) where.isActive = isActive;

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

    // Van/day filters match against the per-day delivery schedule. When both
    // are set, require a single schedule entry satisfying both (that van on
    // that day), not separate entries.
    if (vanId || dayOfWeek !== undefined) {
      where.deliverySchedules = {
        some: {
          ...(vanId ? { vanId } : {}),
          ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
        },
      };
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
        route: { select: { id: true, name: true } },
        wallets: {
          select: {
            id: true,
            balance: true,
            product: { select: { id: true, name: true } },
          },
        },
        customPrices: {
          select: {
            id: true,
            productId: true,
            customPrice: true,
            product: { select: { id: true, name: true, basePrice: true } },
          },
        },
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

  async updateLocation(vendorId: string, id: string, latitude: number, longitude: number) {
    const customer = await this.prisma.customer.findFirst({ where: { id, vendorId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        latitude,
        longitude,
        googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
      },
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

    await this.audit.log({ vendorId, action: 'UPDATE', entity: 'Customer', entityId: id });

    return updated;
  }

  async remove(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, vendorId },
      include: {
        _count: {
          select: {
            transactions: true,
            paymentRequests: { where: { status: { in: ['PENDING', 'PROCESSING'] } } },
            orders: { where: { status: { in: ['PENDING', 'APPROVED'] } } },
            damageCases: { where: { status: { in: ['REPORTED', 'UNDER_REVIEW', 'CHARGED'] } } },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer._count.transactions > 0) {
      throw new ConflictException(
        'Cannot delete customer with transaction history. Deactivate instead.',
      );
    }
    if (customer._count.paymentRequests > 0) {
      throw new ConflictException('Cannot delete customer with open payment requests. Resolve them first.');
    }
    if (customer._count.orders > 0) {
      throw new ConflictException('Cannot delete customer with open orders. Resolve them first.');
    }
    if (customer._count.damageCases > 0) {
      throw new ConflictException('Cannot delete customer with active damage cases. Resolve them first.');
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
      include: { product: { select: { id: true, name: true, basePrice: true } } },
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
      include: {
        customPrices: { select: { productId: true, customPrice: true } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const transactions = await this.prisma.transaction.findMany({
      where: {
        customerId,
        vendorId,
        createdAt: { gte: startDate, lt: endDate },
      },
      include: {
        product: { select: { name: true, basePrice: true } },
        dailySheetItem: { select: { bottleBalanceAfter: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Actual rate for this customer: their custom price if one is set for the
    // product they're delivered, otherwise the product's base price — not an
    // average derived from amounts charged (which can be skewed by adjustments).
    // Falls back past this month's window since a month with zero deliveries
    // (e.g. a MONTHLY customer skipped this period) still has an assigned rate.
    let ratePerBottle = 0;
    const lastDeliveryInPeriod = [...transactions].reverse().find((t) => t.type === 'DELIVERY' && t.productId && t.product);
    if (lastDeliveryInPeriod) {
      ratePerBottle = this.resolveCustomerPrice(customer, lastDeliveryInPeriod.productId as string, lastDeliveryInPeriod.product!.basePrice);
    } else {
      const lastDeliveryEver = await this.prisma.transaction.findFirst({
        where: { customerId, vendorId, type: 'DELIVERY', productId: { not: null } },
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { basePrice: true } } },
      });
      if (lastDeliveryEver?.productId && lastDeliveryEver.product) {
        ratePerBottle = this.resolveCustomerPrice(customer, lastDeliveryEver.productId, lastDeliveryEver.product.basePrice);
      } else if (customer.customPrices.length > 0) {
        ratePerBottle = customer.customPrices[0].customPrice;
      }
    }

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
      month: targetMonth,
      ratePerBottle,
    };
  }

  async getMonthlyStatementPdf(vendorId: string, customerId: string, month?: string): Promise<Buffer> {
    const data = await this.getMonthlyStatement(vendorId, customerId, month);
    return this.statementPdf.generate(data);
  }

  async deactivate(vendorId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, vendorId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const pendingItems = await this.prisma.dailySheetItem.count({
      where: { customerId: id, status: 'PENDING', dailySheet: { isClosed: false } },
    });
    if (pendingItems > 0) {
      throw new ConflictException(
        `Customer has ${pendingItems} pending delivery item(s). Complete or cancel them before deactivating.`
      );
    }

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
    // Ensure wallet records exist for all active products (customer may have missed product creation while inactive)
    const activeProducts = await this.prisma.product.findMany({
      where: { vendorId, isActive: true },
      select: { id: true },
    });
    if (activeProducts.length > 0) {
      await this.prisma.bottleWallet.createMany({
        data: activeProducts.map((p) => ({ customerId: id, productId: p.id, balance: 0 })),
        skipDuplicates: true,
      });
    }
    await this.audit.log({ vendorId, action: 'REACTIVATE', entity: 'Customer', entityId: id });
    return updated;
  }

  async getConsumptionStats(vendorId: string, customerId: string, query: ConsumptionQueryDto) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    // Local-date formatting — toISOString() would shift dates across UTC boundaries
    const toDateStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      include: {
        wallets: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startDate: Date;
    let endExclusive: Date;
    let periodAllTime = false;

    if (query.allTime === 'true') {
      // Earliest DELIVERY transaction for this customer, fallback to customer.createdAt
      const earliest = await this.prisma.transaction.findFirst({
        where: { customerId, vendorId, type: 'DELIVERY' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      startDate = earliest ? earliest.createdAt : customer.createdAt;
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      endExclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      periodAllTime = true;
    } else if (query.from || query.to) {
      const toDate = query.to ? new Date(query.to) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const fromDate = query.from
        ? new Date(query.from)
        : new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() - 29);
      startDate = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
      endExclusive = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
    } else if (query.month) {
      const [year, mon] = query.month.split('-').map(Number);
      startDate = new Date(year, mon - 1, 1);
      endExclusive = new Date(year, mon, 1);
    } else {
      // Default: last 30 days (today included)
      const toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() - 29);
      startDate = fromDate;
      endExclusive = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
    }

    const effectiveEnd = endExclusive <= now ? endExclusive : now;
    const periodDays = Math.max(1, Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / 86_400_000));
    // period.to = last inclusive day (endExclusive - 1 day)
    const periodTo = new Date(endExclusive.getTime() - 86_400_000);

    const deliveries = await this.prisma.transaction.findMany({
      where: {
        customerId,
        vendorId,
        type: 'DELIVERY',
        createdAt: { gte: startDate, lt: endExclusive },
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
    const avgPerDelivery = deliveryCount > 0 ? r2(totalFilled / deliveryCount) : 0;
    const bottlesPerDay = r2(totalFilled / periodDays);
    const avgDaysBetweenDeliveries = deliveryCount > 0 ? r1(periodDays / deliveryCount) : null;

    // Period includes present when effectiveEnd >= now (i.e. endExclusive is in the future or now)
    const periodIncludesNow = endExclusive.getTime() > now.getTime();

    // Per-wallet stats with periodEndWalletBalance reconstruction
    const walletStats = await Promise.all(
      customer.wallets.map(async (w) => {
        const walletDeliveries = deliveries.filter((d) => d.product?.id === w.productId);
        const walletFilled = walletDeliveries.reduce((sum, d) => sum + (d.filledDropped ?? 0), 0);
        const walletEmpty = walletDeliveries.reduce((sum, d) => sum + (d.emptyReceived ?? 0), 0);
        const walletAvg = walletDeliveries.length > 0 ? r2(walletFilled / walletDeliveries.length) : 0;

        let periodEndWalletBalance: number;
        if (periodIncludesNow) {
          periodEndWalletBalance = w.balance;
        } else {
          // Reconstruct balance at period end by reversing changes made after endExclusive
          const [txAgg, damageAgg] = await Promise.all([
            this.prisma.transaction.aggregate({
              where: {
                customerId,
                vendorId,
                productId: w.productId,
                type: { in: ['DELIVERY', 'ADJUSTMENT'] },
                bottleCount: { not: null },
                createdAt: { gte: endExclusive },
              },
              _sum: { bottleCount: true },
            }),
            this.prisma.damageCase.aggregate({
              where: {
                customerId,
                productId: w.productId,
                caseType: DamageCaseType.LOST,
                status: { in: [DamageCaseStatus.CHARGED, DamageCaseStatus.WAIVED] },
                reviewedAt: { gte: endExclusive },
              },
              _sum: { bottleCount: true },
            }),
          ]);
          const txDeltaAfter = txAgg._sum.bottleCount ?? 0;
          // LOST damage cases DECREMENT the wallet at review time, so add them back
          const damageBottlesAfter = damageAgg._sum.bottleCount ?? 0;
          periodEndWalletBalance = w.balance - txDeltaAfter + damageBottlesAfter;
        }

        const rateNum = periodEndWalletBalance > 0 ? r2((walletAvg / periodEndWalletBalance) * 100) : null;
        const consumptionRate = rateNum !== null ? `${rateNum}%` : 'N/A';

        let rateStatus: 'ON_TARGET' | 'ATTENTION' | 'ACTION' | null = null;
        if (rateNum !== null) {
          if (rateNum >= 70 && rateNum <= 90) rateStatus = 'ON_TARGET';
          else if ((rateNum >= 50 && rateNum < 70) || (rateNum > 90 && rateNum <= 100)) rateStatus = 'ATTENTION';
          else rateStatus = 'ACTION';
        }

        // Use days since first delivery (not full period window) so a new customer
        // with 1 delivery doesn't get their rate diluted across 30 empty days.
        const firstDeliveryAt = walletDeliveries.length > 0
          ? walletDeliveries.reduce((min, d) => (d.createdAt < min ? d.createdAt : min), walletDeliveries[0].createdAt)
          : null;
        const activeDays = firstDeliveryAt
          ? Math.max(1, Math.ceil((effectiveEnd.getTime() - firstDeliveryAt.getTime()) / 86_400_000))
          : periodDays;
        const walletBottlesPerDay = r2(walletFilled / activeDays);

        const includesToday = effectiveEnd.getTime() >= startOfToday.getTime();
        // Require at least 2 deliveries: with only 1 we can't know the cycle yet.
        const estStockDaysLeft =
          includesToday && walletDeliveries.length >= 2 && walletBottlesPerDay > 0
            ? r1(w.balance / walletBottlesPerDay)
            : null;

        return {
          product: w.product,
          currentWalletBalance: w.balance,
          periodEndWalletBalance,
          deliveryCount: walletDeliveries.length,
          totalConsumed: walletFilled,
          totalEmptyReceived: walletEmpty,
          avgPerDelivery: walletAvg,
          bottlesPerDay: walletBottlesPerDay,
          estStockDaysLeft,
          consumptionRate,
          rateStatus,
        };
      }),
    );

    // Trend: previous adjacent window of equal length (null when allTime)
    let trend: {
      prevFrom: string;
      prevTo: string;
      prevBottlesPerDay: number;
      changePct: number | null;
    } | null = null;

    if (!periodAllTime) {
      const windowMs = effectiveEnd.getTime() - startDate.getTime();
      const prevStart = new Date(startDate.getTime() - windowMs);
      const prevEndExclusive = startDate;

      const prevAgg = await this.prisma.transaction.aggregate({
        where: {
          customerId,
          vendorId,
          type: 'DELIVERY',
          createdAt: { gte: prevStart, lt: prevEndExclusive },
        },
        _sum: { filledDropped: true },
      });

      const prevFilled = prevAgg._sum.filledDropped ?? 0;
      const prevBottlesPerDay = r2(prevFilled / periodDays);
      const prevTo = new Date(prevEndExclusive.getTime() - 86_400_000);
      const changePct =
        prevBottlesPerDay > 0 ? r2(((bottlesPerDay - prevBottlesPerDay) / prevBottlesPerDay) * 100) : null;

      trend = {
        prevFrom: toDateStr(prevStart),
        prevTo: toDateStr(prevTo),
        prevBottlesPerDay,
        changePct,
      };
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      period: {
        from: toDateStr(startDate),
        to: toDateStr(periodTo),
        days: periodDays,
        allTime: periodAllTime,
      },
      summary: {
        deliveryCount,
        totalFilledDropped: totalFilled,
        totalEmptyReceived: totalEmpty,
        avgFilledPerDelivery: avgPerDelivery,
        bottlesPerDay,
        avgDaysBetweenDeliveries,
      },
      byProduct: walletStats,
      trend,
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

  private buildPricingWhere(vendorId: string, dto: BulkPriceFiltersDto) {
    const where: any = { vendorId, isActive: true };

    if (dto.area) {
      where.address = { contains: dto.area, mode: 'insensitive' };
    }

    if (dto.billingType) {
      where.paymentType = dto.billingType;
    }

    if (dto.vanId) {
      where.deliverySchedules = { some: { vanId: dto.vanId } };
    }

    return where;
  }

  private resolveCustomerPrice(
    customer: { customPrices: { productId: string; customPrice: number }[] },
    productId: string,
    basePrice: number,
  ): number {
    const cp = customer.customPrices.find((p) => p.productId === productId);
    return cp ? cp.customPrice : basePrice;
  }

  async previewBulkPricing(vendorId: string, dto: BulkPriceFiltersDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorId },
      select: { basePrice: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const where = this.buildPricingWhere(vendorId, dto);

    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        customPrices: {
          where: { productId: dto.productId },
          select: { productId: true, customPrice: true },
        },
      },
    });

    const rows = customers
      .map((c) => ({
        id: c.id,
        name: c.name,
        area: c.address,
        currentPrice: this.resolveCustomerPrice(c, dto.productId, product.basePrice),
      }))
      .filter((r) => {
        if (dto.priceFrom !== undefined && r.currentPrice < dto.priceFrom) return false;
        if (dto.priceTo !== undefined && r.currentPrice > dto.priceTo) return false;
        return true;
      });

    // Accurate total count, but only return 50 rows for display to keep payload small.
    // Do NOT add a take limit on the findMany — that would make count inaccurate.
    return { count: rows.length, customers: rows.slice(0, 50) };
  }

  /**
   * Resolve the matched customers for a bulk price update and enqueue a background
   * BullMQ job to perform the (potentially large) set of upserts in batches.
   * Returns immediately with the job id so the request never times out.
   */
  async enqueueBulkPriceUpdate(vendorId: string, dto: BulkPriceUpdateDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.filters.productId, vendorId },
      select: { basePrice: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const where = this.buildPricingWhere(vendorId, dto.filters);

    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        customPrices: {
          where: { productId: dto.filters.productId },
          select: { productId: true, customPrice: true },
        },
      },
    });

    const customerIds: string[] = [];
    const currentPrices: Record<string, number> = {};

    for (const c of customers) {
      const currentPrice = this.resolveCustomerPrice(c, dto.filters.productId, product.basePrice);
      if (dto.filters.priceFrom !== undefined && currentPrice < dto.filters.priceFrom) continue;
      if (dto.filters.priceTo !== undefined && currentPrice > dto.filters.priceTo) continue;
      customerIds.push(c.id);
      currentPrices[c.id] = currentPrice;
    }

    if (customerIds.length === 0) {
      return { jobId: null, totalCustomers: 0 };
    }

    const job = await this.bulkPriceQueue.add(
      JOB_NAMES.BULK_PRICE_UPDATE,
      {
        vendorId,
        productId: dto.filters.productId,
        customerIds,
        currentPrices,
        action: dto.action,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    return { jobId: job.id, totalCustomers: customerIds.length };
  }

  async getBulkUpdateJobStatus(vendorId: string, jobId: string) {
    const job = await this.bulkPriceQueue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');

    // Multi-tenant security: verify the job belongs to the requesting vendor.
    if (job.data.vendorId !== vendorId) throw new NotFoundException('Job not found');

    const state = await job.getState();
    const progress = (job.progress as number) ?? 0;
    const result = job.returnvalue as { updatedCount: number } | null;

    return {
      jobId: job.id,
      state,
      progress,
      totalCustomers: job.data.customerIds.length,
      updatedCount: result?.updatedCount ?? 0,
    };
  }

  /**
   * Bulk-reassign the delivery schedule (van and/or day) for an explicit set of
   * selected customers, in a single interactive transaction.
   *  - vanId only: keep each customer's existing day(s), repoint their schedule rows to the new van.
   *  - dayOfWeek only: replace each customer's entire schedule with one entry on that
   *    day, keeping their existing van (skipped if they have no van to carry over).
   *  - both: replace each customer's entire schedule with one entry on that day/van.
   */
  async bulkUpdateSchedule(vendorId: string, dto: BulkScheduleUpdateDto) {
    if (!dto.vanId && dto.dayOfWeek === undefined) {
      throw new BadRequestException('Provide a van, a delivery day, or both');
    }

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: dto.customerIds }, vendorId },
      select: {
        id: true,
        name: true,
        deliverySchedules: { select: { vanId: true } },
      },
    });

    if (customers.length === 0) {
      throw new NotFoundException('No matching customers found');
    }

    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({
        where: { id: dto.vanId, vendorId, isActive: true },
        select: { id: true },
      });
      if (!van) throw new NotFoundException('Van not found or inactive');
    }

    const skipped: Array<{ customerId: string; name: string; reason: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const customer of customers) {
        if (dto.dayOfWeek !== undefined) {
          const vanId = dto.vanId ?? customer.deliverySchedules[0]?.vanId;
          if (!vanId) {
            skipped.push({ customerId: customer.id, name: customer.name, reason: 'No van assigned' });
            continue;
          }
          await tx.customerDeliverySchedule.deleteMany({ where: { customerId: customer.id } });
          await tx.customerDeliverySchedule.create({
            data: { customerId: customer.id, vanId, dayOfWeek: dto.dayOfWeek },
          });
        } else if (dto.vanId) {
          await tx.customerDeliverySchedule.updateMany({
            where: { customerId: customer.id },
            data: { vanId: dto.vanId },
          });
        }
      }
    });

    await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

    const updatedCount = customers.length - skipped.length;

    await this.audit.log({
      vendorId,
      action: 'BULK_UPDATE',
      entity: 'CustomerDeliverySchedule',
      changes: {
        after: {
          customerIds: dto.customerIds,
          vanId: dto.vanId,
          dayOfWeek: dto.dayOfWeek,
          updatedCount,
        },
      },
    });

    return {
      requestedCount: dto.customerIds.length,
      updatedCount,
      skippedCount: skipped.length,
      skipped,
    };
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
