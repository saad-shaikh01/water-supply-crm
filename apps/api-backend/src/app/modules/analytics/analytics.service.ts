import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import { TransactionType, PaymentType } from '@prisma/client';

function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const filter: any = {};
  if (from) filter.gte = new Date(from);
  if (to) filter.lte = new Date(to);
  return filter;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async getFinancial(vendorId: string, from?: string, to?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:financial:${from ?? ''}:${to ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const [transactions, expenses, sheets, customers] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          vendorId,
          type: TransactionType.DELIVERY,
          ...(dateFilter && { createdAt: dateFilter }),
        },
        select: {
          amount: true,
          createdAt: true,
          customerId: true,
          customer: { select: { paymentType: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
        },
        select: { amount: true, category: true, date: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.dailySheet.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
        },
        select: {
          cashExpected: true,
          cashCollected: true,
          routeId: true,
          route: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.aggregate({
        where: { vendorId },
        _sum: { financialBalance: true },
      }),
    ]);

    // Revenue totals
    const totalRevenue = transactions.reduce((s, t) => s + (t.amount ?? 0), 0);

    // Revenue by day
    const revenueByDayMap = new Map<string, number>();
    for (const t of transactions) {
      const day = t.createdAt.toISOString().slice(0, 10);
      revenueByDayMap.set(day, (revenueByDayMap.get(day) ?? 0) + (t.amount ?? 0));
    }
    const revenueByDay = Array.from(revenueByDayMap.entries()).map(([date, amount]) => ({ date, amount }));

    // Expenses totals and by category
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const byCatMap = new Map<string, number>();
    const expByDayMap = new Map<string, number>();
    for (const e of expenses) {
      byCatMap.set(e.category, (byCatMap.get(e.category) ?? 0) + e.amount);
      const day = e.date.toISOString().slice(0, 10);
      expByDayMap.set(day, (expByDayMap.get(day) ?? 0) + e.amount);
    }
    const expensesByCategory = Array.from(byCatMap.entries()).map(([category, amount]) => ({ category, amount }));
    const expensesByDay = Array.from(expByDayMap.entries()).map(([date, amount]) => ({ date, amount }));

    // Profit by day (merge revenue and expense days)
    const allDays = new Set([...revenueByDayMap.keys(), ...expByDayMap.keys()]);
    const profitByDay = Array.from(allDays)
      .sort()
      .map((date) => {
        const rev = revenueByDayMap.get(date) ?? 0;
        const exp = expByDayMap.get(date) ?? 0;
        return { date, revenue: rev, expenses: exp, profit: rev - exp };
      });

    // Revenue by route
    const routeRevMap = new Map<string, { routeId: string; routeName: string; revenue: number }>();
    for (const sheet of sheets) {
      const key = sheet.routeId;
      const entry = routeRevMap.get(key) ?? { routeId: sheet.routeId, routeName: sheet.route.name, revenue: 0 };
      entry.revenue += sheet.cashCollected;
      routeRevMap.set(key, entry);
    }
    const revenueByRoute = Array.from(routeRevMap.values()).sort((a, b) => b.revenue - a.revenue);

    // Revenue by payment type
    const revenueByPaymentType = { CASH: 0, MONTHLY: 0 };
    for (const t of transactions) {
      const pt = t.customer?.paymentType;
      if (pt === PaymentType.CASH) revenueByPaymentType.CASH += t.amount ?? 0;
      else if (pt === PaymentType.MONTHLY) revenueByPaymentType.MONTHLY += t.amount ?? 0;
    }

    // Collection rate
    const totalExpected = sheets.reduce((s, sh) => s + sh.cashExpected, 0);
    const totalCollected = sheets.reduce((s, sh) => s + sh.cashCollected, 0);
    const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    const result = {
      revenue: { total: totalRevenue, byDay: revenueByDay },
      expenses: { total: totalExpenses, byCategory: expensesByCategory, byDay: expensesByDay },
      profit: { total: totalRevenue - totalExpenses, byDay: profitByDay },
      revenueByRoute,
      revenueByPaymentType,
      collectionRate,
      outstandingBalance: customers._sum.financialBalance ?? 0,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getDeliveries(vendorId: string, from?: string, to?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:deliveries:${from ?? ''}:${to ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const [items, openIssues, resolvedIssues] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where: {
          dailySheet: {
            vendorId,
            ...(dateFilter && { date: dateFilter }),
          },
        },
        select: {
          status: true,
          deliveryType: true,
          reason: true,
          dailySheet: {
            select: {
              date: true,
              route: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.deliveryIssue.findMany({
        where: {
          vendorId,
          status: { in: ['OPEN', 'PLANNED', 'IN_RETRY'] },
        },
        select: { createdAt: true, status: true },
      }),
      this.prisma.deliveryIssue.findMany({
        where: {
          vendorId,
          status: 'RESOLVED',
          ...(dateFilter && { resolvedAt: dateFilter }),
        },
        select: { resolution: true },
      }),
    ]);

    const completedStatuses = new Set(['COMPLETED', 'EMPTY_ONLY']);
    const missedStatuses = new Set(['CANCELLED', 'NOT_AVAILABLE']);

    const total = items.length;
    const completed = items.filter((i) => completedStatuses.has(i.status)).length;
    const missed = items.filter((i) => missedStatuses.has(i.status)).length;
    const pending = items.filter((i) => i.status === 'PENDING').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // By day
    const byDayMap = new Map<string, { completed: number; missed: number; pending: number }>();
    for (const item of items) {
      const day = item.dailySheet.date.toISOString().slice(0, 10);
      const entry = byDayMap.get(day) ?? { completed: 0, missed: 0, pending: 0 };
      if (completedStatuses.has(item.status)) entry.completed++;
      else if (missedStatuses.has(item.status)) entry.missed++;
      else if (item.status === 'PENDING') entry.pending++;
      byDayMap.set(day, entry);
    }
    const byDay = Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    // By day of week (0=Sun, 1=Mon ... 6=Sat)
    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDowMap = new Map<number, { count: number; completed: number }>();
    for (const item of items) {
      const dow = item.dailySheet.date.getDay();
      const entry = byDowMap.get(dow) ?? { count: 0, completed: 0 };
      entry.count++;
      if (completedStatuses.has(item.status)) entry.completed++;
      byDowMap.set(dow, entry);
    }
    const byDayOfWeek = Array.from({ length: 7 }, (_, i) => {
      const entry = byDowMap.get(i) ?? { count: 0, completed: 0 };
      return {
        day: i,
        label: DOW_LABELS[i],
        count: entry.count,
        completionRate: entry.count > 0 ? Math.round((entry.completed / entry.count) * 100) : 0,
      };
    });

    // By route
    const byRouteMap = new Map<string, { routeName: string; completed: number; total: number }>();
    for (const item of items) {
      const routeId = item.dailySheet.route.id;
      const entry = byRouteMap.get(routeId) ?? { routeName: item.dailySheet.route.name, completed: 0, total: 0 };
      entry.total++;
      if (completedStatuses.has(item.status)) entry.completed++;
      byRouteMap.set(routeId, entry);
    }
    const byRoute = Array.from(byRouteMap.values()).map(({ routeName, completed: c, total: t }) => ({
      routeName,
      completed: c,
      missed: t - c,
      rate: t > 0 ? Math.round((c / t) * 100) : 0,
    }));

    // Missed reasons
    const reasonMap = new Map<string, number>();
    for (const item of items) {
      if (missedStatuses.has(item.status)) {
        const reason = item.reason ?? item.status;
        reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
      }
    }
    const missedReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Ops KPIs: delivery issues
    const now = Date.now();
    const MS_PER_DAY = 86_400_000;
    const issueAgingBuckets = {
      lessThan1d: 0,
      oneToThreeDays: 0,
      fourToSevenDays: 0,
      moreThan7d: 0,
    };
    for (const issue of openIssues) {
      const ageDays = (now - issue.createdAt.getTime()) / MS_PER_DAY;
      if (ageDays < 1) issueAgingBuckets.lessThan1d++;
      else if (ageDays < 4) issueAgingBuckets.oneToThreeDays++;
      else if (ageDays < 8) issueAgingBuckets.fourToSevenDays++;
      else issueAgingBuckets.moreThan7d++;
    }

    // On-demand fulfillment rate
    const onDemandItems = items.filter((i) => i.deliveryType === 'ON_DEMAND');
    const onDemandCompleted = onDemandItems.filter((i) => completedStatuses.has(i.status)).length;
    const onDemandFulfillmentRate =
      onDemandItems.length > 0
        ? Math.round((onDemandCompleted / onDemandItems.length) * 100)
        : null;

    // Retry success rate (resolved issues with DELIVERED resolution)
    const retryDelivered = resolvedIssues.filter((i) => i.resolution === 'DELIVERED').length;
    const retrySuccessRate =
      resolvedIssues.length > 0
        ? Math.round((retryDelivered / resolvedIssues.length) * 100)
        : null;

    const result = {
      summary: { total, completed, missed, pending, completionRate },
      byDay,
      byDayOfWeek,
      byRoute,
      missedReasons,
      opsKpis: {
        openIssues: openIssues.length,
        issueAgingBuckets,
        onDemandFulfillmentRate,
        retrySuccessRate,
      },
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getCustomers(vendorId: string, from?: string, to?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:customers:${from ?? ''}:${to ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const [allCustomers, newCustomers, topByRevenue, highestBalances] = await Promise.all([
      this.prisma.customer.findMany({
        where: { vendorId },
        select: { id: true, isActive: true, paymentType: true, createdAt: true },
      }),
      this.prisma.customer.count({
        where: {
          vendorId,
          ...(dateFilter && { createdAt: dateFilter }),
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['customerId'],
        where: {
          vendorId,
          type: TransactionType.DELIVERY,
          customerId: { not: null },
          ...(dateFilter && { createdAt: dateFilter }),
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      this.prisma.customer.findMany({
        where: { vendorId, financialBalance: { gt: 0 } },
        select: { id: true, name: true, customerCode: true, financialBalance: true },
        orderBy: { financialBalance: 'desc' },
        take: 10,
      }),
    ]);

    const total = allCustomers.length;
    const active = allCustomers.filter((c) => c.isActive).length;
    const inactive = total - active;
    const cashCustomers = allCustomers.filter((c) => c.paymentType === PaymentType.CASH).length;
    const monthlyCustomers = allCustomers.filter((c) => c.paymentType === PaymentType.MONTHLY).length;

    // Growth by month (last 12 months regardless of date range)
    const now = new Date();
    const growthByMonth = [];
    const sorted = [...allCustomers].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('en', { month: 'short', year: 'numeric' });
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const newInMonth = sorted.filter((c) => c.createdAt >= d && c.createdAt <= monthEnd).length;
      const cumulative = sorted.filter((c) => c.createdAt <= monthEnd).length;
      growthByMonth.push({ month: label, new: newInMonth, cumulative });
    }

    // Enrich top by revenue
    const customerIds = topByRevenue.map((t) => t.customerId).filter(Boolean) as string[];
    const customerDetails = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, customerCode: true },
    });
    const customerMap = new Map(customerDetails.map((c) => [c.id, c]));
    const topByRevenueEnriched = topByRevenue.map((t) => ({
      ...customerMap.get(t.customerId!),
      revenue: t._sum.amount ?? 0,
    }));

    const result = {
      summary: { total, active, inactive, newThisPeriod: newCustomers },
      paymentTypeBreakdown: { CASH: cashCustomers, MONTHLY: monthlyCustomers },
      growthByMonth,
      topByRevenue: topByRevenueEnriched,
      highestBalances,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getStaff(vendorId: string, from?: string, to?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:staff:${from ?? ''}:${to ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const sheets = await this.prisma.dailySheet.findMany({
      where: {
        vendorId,
        ...(dateFilter && { date: dateFilter }),
      },
      include: {
        driver: { select: { id: true, name: true, role: true } },
        items: {
          select: { status: true, filledDropped: true, cashCollected: true },
        },
      },
    });

    const completedStatuses = new Set(['COMPLETED', 'EMPTY_ONLY', 'DELIVERED']);
    const byDriver = new Map<string, { driver: any; sheets: typeof sheets }>();
    for (const sheet of sheets) {
      const entry = byDriver.get(sheet.driverId) ?? { driver: sheet.driver, sheets: [] };
      entry.sheets.push(sheet);
      byDriver.set(sheet.driverId, entry);
    }

    const staff = Array.from(byDriver.values()).map(({ driver, sheets: driverSheets }) => {
      const allItems = driverSheets.flatMap((s) => s.items);
      const totalItems = allItems.length;
      const deliveredItems = allItems.filter((i) => completedStatuses.has(i.status)).length;
      const bottlesDelivered = allItems
        .filter((i) => completedStatuses.has(i.status))
        .reduce((s, i) => s + i.filledDropped, 0);
      const cashCollected = allItems.reduce((s, i) => s + i.cashCollected, 0);
      return {
        name: driver.name,
        role: driver.role,
        deliveries: totalItems,
        completionRate: totalItems > 0 ? Math.round((deliveredItems / totalItems) * 100) : 0,
        cashCollected,
        bottlesDelivered,
      };
    });

    staff.sort((a, b) => b.completionRate - a.completionRate);
    const result = { staff, leaderboard: staff };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }
}
