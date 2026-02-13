import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
  CACHE_TTLS,
} from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async getOverview(vendorId: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:overview`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const [
      totalCustomers,
      totalProducts,
      totalRoutes,
      totalVans,
      totalDrivers,
      balanceAgg,
      bottleAgg,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { vendorId } }),
      this.prisma.product.count({ where: { vendorId, isActive: true } }),
      this.prisma.route.count({ where: { vendorId } }),
      this.prisma.van.count({ where: { vendorId } }),
      this.prisma.user.count({
        where: { vendorId, role: 'DRIVER', isActive: true },
      }),
      this.prisma.customer.aggregate({
        where: { vendorId },
        _sum: { financialBalance: true },
      }),
      this.prisma.bottleWallet.aggregate({
        where: { customer: { vendorId } },
        _sum: { balance: true },
      }),
    ]);

    const result = {
      totalCustomers,
      totalProducts,
      totalRoutes,
      totalVans,
      totalDrivers,
      totalOutstandingBalance: balanceAgg._sum.financialBalance ?? 0,
      totalBottlesOut: bottleAgg._sum.balance ?? 0,
    };

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }

  async getDailyStats(vendorId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    const dateRange = { gte: targetDate, lt: nextDate };

    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:daily:${targetDate.toISOString().slice(0, 10)}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const [sheets, deliveryItems, cashAgg, bottleAgg] = await Promise.all([
      this.prisma.dailySheet.findMany({
        where: { vendorId, date: dateRange },
        select: {
          id: true,
          isClosed: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.dailySheetItem.findMany({
        where: {
          dailySheet: { vendorId, date: dateRange },
          status: { in: ['COMPLETED', 'EMPTY_ONLY'] },
        },
        select: { filledDropped: true, cashCollected: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          vendorId,
          type: TransactionType.PAYMENT,
          createdAt: dateRange,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          vendorId,
          type: TransactionType.DELIVERY,
          createdAt: dateRange,
        },
        _sum: { bottleCount: true },
      }),
    ]);

    const result = {
      date: targetDate.toISOString().slice(0, 10),
      totalSheets: sheets.length,
      closedSheets: sheets.filter((s) => s.isClosed).length,
      openSheets: sheets.filter((s) => !s.isClosed).length,
      totalDeliveries: deliveryItems.length,
      totalBottlesDelivered: deliveryItems.reduce(
        (sum, i) => sum + i.filledDropped,
        0,
      ),
      totalCashCollected: deliveryItems.reduce(
        (sum, i) => sum + i.cashCollected,
        0,
      ),
      totalPaymentsReceived: Math.abs(cashAgg._sum.amount ?? 0),
      netBottleChange: bottleAgg._sum.bottleCount ?? 0,
    };

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }

  async getRevenue(vendorId: string, dateFrom?: string, dateTo?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:revenue:${dateFrom}:${dateTo}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const where: any = {
      vendorId,
      type: TransactionType.DELIVERY,
    };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const byDate = new Map<string, number>();
    for (const t of transactions) {
      const dateStr = t.createdAt.toISOString().slice(0, 10);
      byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + (t.amount ?? 0));
    }

    const result = Array.from(byDate.entries()).map(([date, revenue]) => ({
      date,
      revenue,
    }));

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }

  async getTopCustomers(vendorId: string, limit = 10) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:top-customers:${limit}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const data = await this.prisma.transaction.groupBy({
      by: ['customerId'],
      where: { vendorId, type: TransactionType.DELIVERY, customerId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: limit,
    });

    // Fetch customer names
    const customerIds = data
      .map((d) => d.customerId)
      .filter(Boolean) as string[];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, customerCode: true },
    });

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const result = data.map((d) => ({
      customer: customerMap.get(d.customerId!) ?? null,
      totalRevenue: d._sum.amount ?? 0,
    }));

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }

  async getRoutePerformance(vendorId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:route-performance:${targetDate.toISOString().slice(0, 10)}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const sheets = await this.prisma.dailySheet.findMany({
      where: { vendorId, date: { gte: targetDate, lt: nextDate } },
      include: {
        route: { select: { id: true, name: true } },
        items: {
          select: {
            status: true,
            filledDropped: true,
            cashCollected: true,
          },
        },
      },
    });

    const result = sheets.map((sheet) => {
      const completed = sheet.items.filter((i) => i.status === 'COMPLETED');
      const pending = sheet.items.filter((i) => i.status === 'PENDING');
      const cancelled = sheet.items.filter(
        (i) => i.status === 'CANCELLED' || i.status === 'NOT_AVAILABLE',
      );

      return {
        route: sheet.route,
        sheetId: sheet.id,
        isClosed: sheet.isClosed,
        totalItems: sheet.items.length,
        completedItems: completed.length,
        pendingItems: pending.length,
        cancelledItems: cancelled.length,
        totalBottlesDelivered: completed.reduce(
          (sum, i) => sum + i.filledDropped,
          0,
        ),
        totalCashCollected: sheet.items.reduce(
          (sum, i) => sum + i.cashCollected,
          0,
        ),
        completionRate:
          sheet.items.length > 0
            ? Math.round((completed.length / sheet.items.length) * 100)
            : 0,
      };
    });

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }

  async getStaffPerformance(vendorId: string, from?: string, to?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:staff-performance:${from ?? ''}:${to ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const sheets = await this.prisma.dailySheet.findMany({
      where: {
        vendorId,
        ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
      },
      include: {
        driver: { select: { id: true, name: true } },
        items: {
          select: {
            status: true,
            filledDropped: true,
            cashCollected: true,
          },
        },
      },
    });

    // Group by driverId
    const byDriver = new Map<string, { driver: any; sheets: any[] }>();
    for (const sheet of sheets) {
      const entry = byDriver.get(sheet.driverId) ?? {
        driver: sheet.driver,
        sheets: [],
      };
      entry.sheets.push(sheet);
      byDriver.set(sheet.driverId, entry);
    }

    const deliveredStatuses = new Set(['DELIVERED', 'COMPLETED', 'EMPTY_ONLY']);

    const result = Array.from(byDriver.values()).map(({ driver, sheets: driverSheets }) => {
      const allItems = driverSheets.flatMap((s) => s.items);
      const totalItems = allItems.length;
      const deliveredItems = allItems.filter((i) => deliveredStatuses.has(i.status)).length;
      const cancelledItems = allItems.filter((i) => i.status === 'CANCELLED').length;
      const notAvailable = allItems.filter((i) => i.status === 'NOT_AVAILABLE').length;
      const totalBottlesDelivered = allItems
        .filter((i) => deliveredStatuses.has(i.status))
        .reduce((sum, i) => sum + i.filledDropped, 0);
      const totalCashCollected = allItems.reduce((sum, i) => sum + i.cashCollected, 0);

      return {
        driver,
        stats: {
          totalSheets: driverSheets.length,
          totalItems,
          deliveredItems,
          cancelledItems,
          notAvailable,
          completionRate:
            totalItems > 0
              ? Math.round((deliveredItems / totalItems) * 100)
              : 0,
          totalBottlesDelivered,
          totalCashCollected,
        },
      };
    });

    result.sort((a, b) => b.stats.completionRate - a.stats.completionRate);

    await this.cache.set(cacheKey, result, 60); // 60s TTL
    return result;
  }

  /** Platform-level overview — SUPER_ADMIN only */
  async getPlatformOverview() {
    const cacheKey = 'platform:dashboard:overview';
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalVendors,
      activeVendors,
      suspendedVendors,
      totalCustomers,
      totalDrivers,
      revenueAllTime,
      revenueThisMonth,
      revenueLastMonth,
      deliveriesThisMonth,
      newVendorsThisMonth,
      topVendors,
    ] = await Promise.all([
      this.prisma.vendor.count(),
      this.prisma.vendor.count({ where: { isActive: true } }),
      this.prisma.vendor.count({ where: { isActive: false } }),
      this.prisma.customer.count(),
      this.prisma.user.count({ where: { role: 'DRIVER', isActive: true } }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.DELIVERY },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.DELIVERY, createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.DELIVERY,
          createdAt: { gte: startOfLastMonth, lt: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.dailySheetItem.count({
        where: { status: 'DELIVERED', dailySheet: { date: { gte: startOfMonth } } },
      }),
      this.prisma.vendor.count({ where: { createdAt: { gte: startOfMonth } } }),
      // Top 5 vendors by total transaction amount
      this.prisma.transaction.groupBy({
        by: ['vendorId'],
        where: { type: TransactionType.DELIVERY },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
    ]);

    // Enrich top vendors with names
    const topVendorIds = topVendors.map((v) => v.vendorId);
    const topVendorDetails = await this.prisma.vendor.findMany({
      where: { id: { in: topVendorIds } },
      select: { id: true, name: true, slug: true },
    });
    const vendorMap = Object.fromEntries(topVendorDetails.map((v) => [v.id, v]));

    const revenueThisMonthVal = revenueThisMonth._sum.amount ?? 0;
    const revenueLastMonthVal = revenueLastMonth._sum.amount ?? 0;
    const revenueGrowth =
      revenueLastMonthVal > 0
        ? Math.round(((revenueThisMonthVal - revenueLastMonthVal) / revenueLastMonthVal) * 100)
        : 0;

    const result = {
      vendors: { total: totalVendors, active: activeVendors, suspended: suspendedVendors, newThisMonth: newVendorsThisMonth },
      customers: { total: totalCustomers },
      drivers: { totalActive: totalDrivers },
      revenue: {
        allTime: revenueAllTime._sum.amount ?? 0,
        thisMonth: revenueThisMonthVal,
        lastMonth: revenueLastMonthVal,
        growthPercent: revenueGrowth,
      },
      deliveries: { thisMonth: deliveriesThisMonth },
      topVendors: topVendors.map((v) => ({
        vendor: vendorMap[v.vendorId] ?? { id: v.vendorId },
        totalRevenue: v._sum.amount ?? 0,
      })),
    };

    await this.cache.set(cacheKey, result, CACHE_TTLS.DASHBOARD);
    return result;
  }
}
