import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import {
  TransactionType, PaymentType, DailySheetKind, ExpenseCategory,
  PayrollEntryStatus, DiscrepancyResolutionType,
} from '@prisma/client';
import {
  resolveSheetCash,
  dailySheetItemModifiedOrWhere,
  SHEET_CASH_RELOAD_INCLUDE,
} from '../daily-sheet/sheet-cash.util';
import { VanCashLedgerService } from '../van-cash-ledger/van-cash-ledger.service';

// Customer deactivation actions the generic AuditLog records (see
// CustomerService.deactivate / forceDeactivate / bulkDeactivate) — used to
// derive the Customers tab's "deactivated this period" / retention stat
// without a dedicated column on Customer.
const CUSTOMER_DEACTIVATION_ACTIONS = ['DEACTIVATE', 'FORCE_DEACTIVATE', 'BULK_DEACTIVATE', 'BULK_FORCE_DEACTIVATE'];

function groupSum<T>(items: T[], keyFn: (i: T) => string, valueFn: (i: T) => number): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + valueFn(item));
  }
  return map;
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const filter: any = {};
  if (from) filter.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return filter;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private vanCashLedger: VanCashLedgerService,
  ) {}

  async getFinancial(vendorId: string, from?: string, to?: string, vanId?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:financial:${from ?? ''}:${to ?? ''}:${vanId ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);
    // Merged date+van scope for queries that reach the van through the
    // DailySheet relation (Transaction/DailySheetItem don't carry vanId
    // themselves).
    const sheetScope = dateFilter || vanId ? { ...(dateFilter && { date: dateFilter }), ...(vanId && { vanId }) } : undefined;
    // Customers don't carry a van directly — scoped via their CURRENT
    // delivery-schedule assignment when a van filter is active. Best-effort:
    // a customer switching vans mid-period isn't reflected retroactively.
    const customerVanScope = vanId ? { deliverySchedules: { some: { vanId } } } : {};

    const [transactions, expenses, sheets, customers, deliveryItems] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          vendorId,
          type: TransactionType.DELIVERY,
          // DELIVERY transactions are always linked to the daily sheet they were
          // posted from — filter/group by the sheet's business date, not createdAt
          // (createdAt is the DB insert time, which can lag the actual delivery
          // date when a sheet is entered late).
          ...(sheetScope && { dailySheet: sheetScope }),
        },
        select: {
          amount: true,
          createdAt: true,
          customerId: true,
          customer: { select: { paymentType: true } },
          dailySheet: { select: { date: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
          ...(vanId && { vanId }),
        },
        select: { amount: true, category: true, date: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.dailySheet.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
          ...(vanId && { vanId }),
        },
        select: {
          id: true,
          cashExpected: true,
          cashCollected: true,
          routeId: true,
          route: { select: { id: true, name: true } },
          vanId: true,
          van: { select: { id: true, plateNumber: true } },
          kind: true,
        },
      }),
      this.prisma.customer.aggregate({
        where: { vendorId, ...customerVanScope },
        _sum: { financialBalance: true },
      }),
      this.prisma.dailySheetItem.findMany({
        where: {
          // Voided items are struck from the record — exclude from the
          // cash-by-payment-type expected/collected split.
          status: { not: 'VOIDED' },
          dailySheet: {
            vendorId,
            ...sheetScope,
          },
        },
        select: {
          cashCollected: true,
          filledDropped: true,
          filledReceived: true,
          pricePerBottle: true,
          customer: { select: { paymentType: true } },
          product: { select: { id: true, name: true } },
          // COGS bucketing key (docs/features/product-cost-history-and-cogs.md
          // §3/D5) — the sheet's business date, NOT deliveredAt/createdAt, for
          // consistency with how revenue-by-day/revenue-by-product already
          // bucket by DailySheet.date elsewhere in this function.
          dailySheet: { select: { date: true } },
        },
      }),
    ]);

    // ── Hybrid cash rollups (docs/features/post-close-divergence-banner.md) ──
    // DailySheet.cashExpected/cashCollected are frozen at close and never
    // rewritten by post-close voids/corrections. Detect the closed sheets in
    // range that were edited after close, targeted-reload only those, and use
    // the live VOIDED-excluding recompute for them. Untouched sheets keep their
    // frozen columns so historical numbers stay byte-identical.
    const [modItems, modLoads, modExpenseSheets] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where: {
          dailySheet: { vendorId, ...sheetScope, isClosed: true },
          OR: dailySheetItemModifiedOrWhere as any,
        },
        select: { dailySheetId: true },
      }),
      this.prisma.dailySheetLoad.findMany({
        where: {
          dailySheet: { vendorId, ...sheetScope, isClosed: true },
          editCount: { gt: 0 },
        },
        select: { dailySheetId: true },
      }),
      // Post-Close Expense / Crew Cash Correction — closed sheets whose expense
      // or synced crew-cash rows were corrected after close (marker column
      // bumped each time).
      this.prisma.dailySheet.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
          ...(vanId && { vanId }),
          isClosed: true,
          OR: [
            { postCloseExpenseCorrectionCount: { gt: 0 } },
            { postCloseCrewCashCorrectionCount: { gt: 0 } },
          ],
        },
        select: { id: true },
      }),
    ]);
    const modifiedSheetIds = new Set<string>([
      ...modItems.map((r) => r.dailySheetId),
      ...modLoads.map((r) => r.dailySheetId),
      ...modExpenseSheets.map((r) => r.id),
    ]);
    const resolvedCashMap = new Map<string, ReturnType<typeof resolveSheetCash>>();
    if (modifiedSheetIds.size > 0) {
      const fullSheets = await this.prisma.dailySheet.findMany({
        where: { id: { in: Array.from(modifiedSheetIds) }, vendorId },
        include: SHEET_CASH_RELOAD_INCLUDE as any,
      });
      for (const fs of fullSheets) resolvedCashMap.set(fs.id, resolveSheetCash(fs));
    }
    const effCash = (sh: { id: string; cashExpected: number | null; cashCollected: number | null }) =>
      resolvedCashMap.get(sh.id) ?? {
        cashCollected: sh.cashCollected ?? 0,
        cashExpected: sh.cashExpected ?? 0,
        postCloseModified: false,
      };

    // ── Owner-requested van/office cash drilldown (2026-09-14) ──────────────
    // Van-wise expense + crew-cash totals (to sit alongside the existing
    // van-wise cash-collected/expected), the Walk-in sheets' cash contribution
    // (sheets already in `sheets` above — just split by `kind`), and the
    // Office Cash Ledger's live snapshot (available balance is intentionally
    // NOT date-scoped — "how much cash is in the office right now").
    const [vanExpenseRows, vanCrewCashRows, officeCashStats] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          vendorId,
          vanId: vanId ?? { not: null },
          ...(dateFilter && { date: dateFilter }),
        },
        select: { vanId: true, amount: true },
      }),
      this.prisma.crewCashDistribution.findMany({
        where: {
          vendorId,
          ...(dateFilter && { date: dateFilter }),
          ...(vanId && { dailySheet: { vanId } }),
        },
        select: { amount: true, dailySheet: { select: { vanId: true } } },
      }),
      // vanId here narrows this to that ONE van's own running cash balance
      // (opening + its handovers - its cash-out), not the vendor-wide office
      // pool — see the `officeCash` result comment below.
      this.vanCashLedger.getStats(vendorId, { from, to, vanId } as any),
    ]);
    const expenseByVanMap = groupSum(vanExpenseRows, (r) => r.vanId as string, (r) => r.amount);
    const crewCashByVanMap = groupSum(vanCrewCashRows, (r) => r.dailySheet.vanId, (r) => r.amount);

    // ── Payroll cost (owner-requested 2026-09-16) ────────────────────────
    // "Total Expenses" above never included staff salaries — PayrollEntry
    // lives entirely outside the Expense table — so Gross Profit/Profit
    // Margin were silently overstated. Summed separately as `payrollCost`;
    // `netProfit`/`netProfitMargin` are computed after it below, while Gross
    // Profit itself is left untouched (operational profit before payroll) so
    // nothing that already reads it changes meaning.
    // Payroll periods are typically monthly and rarely line up with an
    // arbitrary analytics date range — a period counts if it overlaps
    // [from, to] at all (or unconditionally, when no range is given). Only
    // finalized entries (APPROVED and beyond) are summed — DRAFT/UNDER_REVIEW
    // rows aren't yet a committed obligation. Always vendor-wide — a payroll
    // period's cost isn't meaningfully splittable to "this one van".
    const payrollWhere: any = {
      vendorId,
      status: { in: [PayrollEntryStatus.APPROVED, PayrollEntryStatus.LOCKED, PayrollEntryStatus.SETTLED] },
    };
    if (from || to) {
      payrollWhere.period = {
        ...(to && { startDate: { lte: new Date(to) } }),
        ...(from && { endDate: { gte: new Date(from) } }),
      };
    }

    // Discrepancy write-offs — cash/bottle/empty shortfalls resolved as
    // COMPANY_LOSS (SheetDiscrepancyCaseService.resolve). Distinct from the
    // Customers tab's Force-Deactivate write-offs: this is operational
    // (driver/route) shrinkage, not a specific customer's bad debt.
    const [payrollAgg, discrepancyRows] = await Promise.all([
      this.prisma.payrollEntry.aggregate({ where: payrollWhere, _sum: { finalPayable: true } }),
      this.prisma.sheetDiscrepancyCase.findMany({
        where: {
          vendorId,
          resolutionType: DiscrepancyResolutionType.COMPANY_LOSS,
          ...(dateFilter && { resolvedAt: dateFilter }),
          ...(vanId && { dailySheet: { vanId } }),
        },
        select: {
          id: true,
          type: true,
          resolvedAt: true,
          resolutionAmount: true,
          driver: { select: { name: true } },
          dailySheet: { select: { van: { select: { plateNumber: true } } } },
        },
        orderBy: { resolvedAt: 'desc' },
      }),
    ]);
    const payrollCost = round2(payrollAgg._sum.finalPayable ?? 0);
    const discrepancyWriteOffTotal = round2(discrepancyRows.reduce((s, r) => s + (r.resolutionAmount ?? 0), 0));
    const discrepancyDetails = discrepancyRows.slice(0, 25).map((r) => ({
      id: r.id,
      date: r.resolvedAt,
      type: r.type,
      amount: round2(r.resolutionAmount ?? 0),
      driverName: r.driver.name,
      vanPlateNumber: r.dailySheet.van?.plateNumber ?? 'Unknown',
    }));

    // Previous-period comparison (month-over-month / period-over-period
    // growth) — only meaningful when the caller picked an explicit range;
    // an "all time" query (no from/to) has no natural "previous period".
    let momGrowth: {
      previousRevenue: number;
      previousProfit: number;
      revenueChangePct: number | null;
      profitChangePct: number | null;
    } | null = null;
    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const periodMs = toDate.getTime() - fromDate.getTime();
      const prevTo = new Date(fromDate.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - periodMs);
      const prevDateFilter = buildDateFilter(prevFrom.toISOString(), prevTo.toISOString());
      const [prevRevAgg, prevExpAgg] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: {
            vendorId,
            type: TransactionType.DELIVERY,
            dailySheet: { date: prevDateFilter, ...(vanId && { vanId }) },
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: { vendorId, date: prevDateFilter, ...(vanId && { vanId }) },
          _sum: { amount: true },
        }),
      ]);
      const previousRevenue = prevRevAgg._sum.amount ?? 0;
      const previousProfit = previousRevenue - (prevExpAgg._sum.amount ?? 0);
      // revenueChangePct/profitChangePct are filled in below once totalRevenue
      // and totalExpenses are computed (this block runs before that section).
      momGrowth = { previousRevenue, previousProfit, revenueChangePct: null, profitChangePct: null };
    }

    // Revenue totals
    const totalRevenue = transactions.reduce((s, t) => s + (t.amount ?? 0), 0);

    // Revenue by day (bucketed by the sheet's business date, not createdAt)
    const revenueByDayMap = groupSum(
      transactions,
      (t) => (t.dailySheet?.date ?? t.createdAt).toISOString().slice(0, 10),
      (t) => t.amount ?? 0,
    );
    const revenueByDay = Array.from(revenueByDayMap.entries()).map(([date, amount]) => ({ date, amount }));

    // Expenses totals and by category
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const profitTotal = totalRevenue - totalExpenses;
    if (momGrowth) {
      momGrowth.revenueChangePct =
        momGrowth.previousRevenue > 0 ? Math.round(((totalRevenue - momGrowth.previousRevenue) / momGrowth.previousRevenue) * 100) : null;
      momGrowth.profitChangePct =
        momGrowth.previousProfit !== 0
          ? Math.round(((profitTotal - momGrowth.previousProfit) / Math.abs(momGrowth.previousProfit)) * 100)
          : null;
    }
    const byCatMap = groupSum(expenses, (e) => e.category, (e) => e.amount);
    const expByDayMap = groupSum(expenses, (e) => e.date.toISOString().slice(0, 10), (e) => e.amount);
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
      // DailySheet.routeId is nullable (sheets can be generated per-van without a
      // route). Bucket route-less sheets under "Unassigned" instead of crashing.
      const key = sheet.routeId ?? 'unassigned';
      const entry = routeRevMap.get(key) ?? { routeId: key, routeName: sheet.route?.name ?? 'Unassigned', revenue: 0 };
      entry.revenue += effCash(sheet).cashCollected;
      routeRevMap.set(key, entry);
    }
    const revenueByRoute = Array.from(routeRevMap.values()).sort((a, b) => b.revenue - a.revenue);

    // Cash collected by van — extended (owner-requested 2026-09-14) with each
    // van's expenses and crew-cash totals plus the resulting pending balance
    // (cashExpected - cashCollected), so the Financial tab can show one
    // consolidated per-van row instead of just cash in/out.
    const vanCashMap = new Map<string, { vanId: string; plateNumber: string; cashExpected: number; cashCollected: number }>();
    for (const sheet of sheets) {
      const entry = vanCashMap.get(sheet.vanId) ?? {
        vanId: sheet.vanId,
        plateNumber: sheet.van?.plateNumber ?? 'Unknown',
        cashExpected: 0,
        cashCollected: 0,
      };
      const c = effCash(sheet);
      entry.cashExpected += c.cashExpected;
      entry.cashCollected += c.cashCollected;
      vanCashMap.set(sheet.vanId, entry);
    }
    const cashByVan = Array.from(vanCashMap.values())
      .map((v) => ({
        ...v,
        pending: round2(v.cashExpected - v.cashCollected),
        expenses: round2(expenseByVanMap.get(v.vanId) ?? 0),
        crewCash: round2(crewCashByVanMap.get(v.vanId) ?? 0),
      }))
      .sort((a, b) => b.cashCollected - a.cashCollected);

    // Walk-in sheets' cash contribution — same `sheets`/`effCash` already
    // computed above, just split out by kind instead of a fresh query.
    const walkInSheets = sheets.filter((sh) => sh.kind === DailySheetKind.WALK_IN);
    const walkInCash = {
      collected: round2(walkInSheets.reduce((s, sh) => s + effCash(sh).cashCollected, 0)),
      expected: round2(walkInSheets.reduce((s, sh) => s + effCash(sh).cashExpected, 0)),
      sheetCount: walkInSheets.length,
    };

    // Revenue by payment type
    const revenueByPaymentType = { CASH: 0, MONTHLY: 0 };
    for (const t of transactions) {
      const pt = t.customer?.paymentType;
      if (pt === PaymentType.CASH) revenueByPaymentType.CASH += t.amount ?? 0;
      else if (pt === PaymentType.MONTHLY) revenueByPaymentType.MONTHLY += t.amount ?? 0;
    }

    // Collection rate
    const totalExpected = sheets.reduce((s, sh) => s + effCash(sh).cashExpected, 0);
    const totalCollected = sheets.reduce((s, sh) => s + effCash(sh).cashCollected, 0);
    const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;

    // Cash expected/collected split by customer payment type (itemized, since
    // DailySheet.cashExpected/cashCollected are sheet-wide totals with no
    // per-customer-type breakdown).
    const cashByPaymentType = { CASH: { expected: 0, collected: 0 }, MONTHLY: { expected: 0, collected: 0 } };
    for (const item of deliveryItems) {
      const pt = item.customer?.paymentType;
      const bucket = pt === PaymentType.CASH ? cashByPaymentType.CASH : pt === PaymentType.MONTHLY ? cashByPaymentType.MONTHLY : null;
      if (!bucket) continue;
      // Net of any filled bottles taken back this delivery — they were credited
      // back to the customer at the same rate, so the "expected" charge is lower.
      bucket.expected += (item.filledDropped - (item.filledReceived ?? 0)) * item.pricePerBottle;
      bucket.collected += item.cashCollected;
    }

    // ── Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md §3/§5) ──
    // Bulk-fetch the full cost history for every product appearing in this
    // report's deliveries — one query, no per-item round trip (§3 "Execution
    // technique"). Voided rows are excluded: a voided ProductCost row isn't a
    // real historical rate. No date filter/pagination — a product's entire
    // cost history is at most tens of rows.
    const costProductIds = Array.from(new Set(deliveryItems.map((i) => i.product.id)));
    const costRows = costProductIds.length
      ? await this.prisma.productCost.findMany({
          where: { vendorId, productId: { in: costProductIds }, voidedAt: null },
          orderBy: { effectiveFrom: 'asc' },
        })
      : [];
    const costsByProduct = new Map<string, typeof costRows>();
    for (const c of costRows) {
      const list = costsByProduct.get(c.productId) ?? [];
      list.push(c);
      costsByProduct.set(c.productId, list);
    }
    // Latest row (by effectiveFrom, list is sorted ascending) whose range
    // covers `date` — effectiveFrom <= date AND (effectiveTo is null OR
    // effectiveTo >= date). Same rule as SalaryStructureService.getEffectiveOn.
    const findApplicableCost = (productId: string, date: Date) => {
      const list = costsByProduct.get(productId);
      if (!list) return null;
      let applicable: (typeof list)[number] | null = null;
      for (const c of list) {
        if (c.effectiveFrom > date) break; // sorted ascending — no later row can match once past `date`
        if (c.effectiveTo && c.effectiveTo < date) continue;
        applicable = c;
      }
      return applicable;
    };

    // Revenue by product — same `deliveryItems` already fetched above (no
    // per-product split exists on the DailySheet/Transaction totals). Folds
    // in the per-item cost lookup so this stays a single pass over
    // `deliveryItems` rather than a second separate loop.
    const productMap = new Map<
      string,
      { productId: string; productName: string; revenue: number; bottles: number; costTotal: number; bottlesCosted: number }
    >();
    let uncostedBottles = 0;
    for (const item of deliveryItems) {
      const entry = productMap.get(item.product.id) ?? {
        productId: item.product.id,
        productName: item.product.name,
        revenue: 0,
        bottles: 0,
        costTotal: 0,
        bottlesCosted: 0,
      };
      // Net of filled-return credits, same as cashByPaymentType's `expected` above.
      entry.revenue += (item.filledDropped - (item.filledReceived ?? 0)) * item.pricePerBottle;
      entry.bottles += item.filledDropped;

      const bucketDate = item.dailySheet?.date ?? null;
      const applicableCost = bucketDate ? findApplicableCost(item.product.id, bucketDate) : null;
      if (applicableCost) {
        entry.costTotal += item.filledDropped * applicableCost.costPerUnit;
        entry.bottlesCosted += item.filledDropped;
      } else {
        uncostedBottles += item.filledDropped;
      }

      productMap.set(item.product.id, entry);
    }
    const revenueByProduct = Array.from(productMap.values())
      .map((p) => {
        const revenue = round2(p.revenue);
        const cost = round2(p.costTotal);
        const margin = round2(p.revenue - p.costTotal);
        return {
          productId: p.productId,
          productName: p.productName,
          revenue,
          bottles: p.bottles,
          cost,
          margin,
          marginPercent: revenue > 0 ? Math.round((margin / revenue) * 100) : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // COGS aggregation (§5, Revision 1 shape) — uncosted bottles (no
    // covering ProductCost row) are excluded from `cogs.total` and surfaced
    // separately, never silently treated as zero cost (§9/§10 "Missing
    // historical costs").
    const totalBottlesDelivered = Array.from(productMap.values()).reduce((s, p) => s + p.bottles, 0);
    const totalBottlesCosted = Array.from(productMap.values()).reduce((s, p) => s + p.bottlesCosted, 0);
    const cogsTotal = round2(Array.from(productMap.values()).reduce((s, p) => s + p.costTotal, 0));
    const coverage = totalBottlesDelivered > 0 ? Math.round((totalBottlesCosted / totalBottlesDelivered) * 100) : null;
    const cogs = {
      total: cogsTotal,
      byProduct: Array.from(productMap.values()).map((p) => ({
        productId: p.productId,
        productName: p.productName,
        bottlesDelivered: p.bottles,
        bottlesCosted: p.bottlesCosted,
        costTotal: round2(p.costTotal),
      })),
      uncostedBottles,
      coverage,
      isPartial: uncostedBottles > 0,
    };
    // grossProfit/grossProfitMargin: null (never a fabricated `totalRevenue -
    // 0`) when there's no cost data at all for the period — either zero
    // deliveries in range (coverage === null) or deliveries exist but none
    // were costed (coverage === 0). A partial-but-nonzero COGS still yields a
    // real, conservative grossProfit.
    const grossProfit = coverage === null || coverage === 0 ? null : round2(totalRevenue - cogsTotal);
    const grossProfitMargin =
      grossProfit === null ? null : totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : null;

    // ── Plant Balance — outstanding balance owed to the plant (owner-requested
    // 2026-09-15 follow-up) ──────────────────────────────────────────────────
    // Deliberately NOT scoped by the `from`/`to` filter, exactly like
    // `officeCash.available` above (see its comment) — this is a running
    // liability ("how much do we currently owe the plant"), not a period P&L
    // figure. Recomputed all-time on every call: `totalCogs` = every
    // delivered bottle ever, costed via the same applicable-historical-cost
    // lookup as the period COGS above, and `totalPaid` = every Expense ever
    // recorded under BOTTLE_PURCHASED or BOTTLE_REFILL_PAYMENT (cash actually
    // handed to the plant — unchanged, unrelated table, this is the first
    // time anything reads it FOR this purpose). Both categories are summed:
    // BOTTLE_REFILL_PAYMENT (added 2026-09-17) is the accurately-named
    // category for plant refill payments going forward, but BOTTLE_PURCHASED
    // is where the same kind of payment was recorded historically (owner
    // feedback: the plant is only ever paid to refill bottles, never for
    // literal new-bottle purchases in practice) — dropping it here would make
    // `outstanding` jump the moment the split shipped. `outstanding` = the
    // gap: what the business has consumed but not yet paid for. Can go
    // negative if the plant has been pre-paid/overpaid (an advance/credit),
    // which is valid, not an error — the frontend renders that state
    // distinctly.
    //
    // Scale note: this re-scans the vendor's ENTIRE delivery history every
    // call (bounded only by the 120s cache below), not just the selected
    // date range. At this business's current scale that's cheap; if a
    // long-lived vendor's history ever makes this measurably slow, the
    // documented next step (mirroring ExpenseCenterService's own precedent
    // for the same trade-off) is a materialized running-balance rollup
    // updated incrementally on each new delivery/payment, not a bigger scan.
    const [allTimeDeliveryItems, allTimeCostRows, plantPaidAgg] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where: {
          status: { not: 'VOIDED' },
          filledDropped: { gt: 0 },
          dailySheet: { vendorId },
        },
        select: { productId: true, filledDropped: true, dailySheet: { select: { date: true } } },
      }),
      this.prisma.productCost.findMany({
        where: { vendorId, voidedAt: null },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          category: { in: [ExpenseCategory.BOTTLE_PURCHASED, ExpenseCategory.BOTTLE_REFILL_PAYMENT] },
        },
        _sum: { amount: true },
      }),
    ]);
    const allTimeCostsByProduct = new Map<string, typeof allTimeCostRows>();
    for (const c of allTimeCostRows) {
      const list = allTimeCostsByProduct.get(c.productId) ?? [];
      list.push(c);
      allTimeCostsByProduct.set(c.productId, list);
    }
    const findAllTimeApplicableCost = (productId: string, date: Date) => {
      const list = allTimeCostsByProduct.get(productId);
      if (!list) return null;
      let applicable: (typeof list)[number] | null = null;
      for (const c of list) {
        if (c.effectiveFrom > date) break;
        if (c.effectiveTo && c.effectiveTo < date) continue;
        applicable = c;
      }
      return applicable;
    };
    let totalCogsAllTime = 0;
    for (const item of allTimeDeliveryItems) {
      const bucketDate = item.dailySheet?.date ?? null;
      const applicableCost = bucketDate ? findAllTimeApplicableCost(item.productId, bucketDate) : null;
      if (applicableCost) totalCogsAllTime += item.filledDropped * applicableCost.costPerUnit;
    }
    totalCogsAllTime = round2(totalCogsAllTime);
    const totalPaidAllTime = round2(plantPaidAgg._sum.amount ?? 0);
    const plantBalance = {
      totalCogs: totalCogsAllTime,
      totalPaid: totalPaidAllTime,
      outstanding: round2(totalCogsAllTime - totalPaidAllTime),
    };

    const result = {
      revenue: { total: totalRevenue, byDay: revenueByDay },
      expenses: { total: totalExpenses, byCategory: expensesByCategory, byDay: expensesByDay },
      profit: { total: profitTotal, byDay: profitByDay },
      profitMargin: totalRevenue > 0 ? Math.round((profitTotal / totalRevenue) * 100) : 0,
      // Payroll sits outside `expenses` (see query comment above) — netProfit
      // is the truer bottom line once salaries are accounted for; Gross
      // Profit/profitMargin above are left as pre-payroll operational figures.
      payrollCost,
      netProfit: round2(profitTotal - payrollCost),
      netProfitMargin: totalRevenue > 0 ? Math.round(((profitTotal - payrollCost) / totalRevenue) * 100) : 0,
      discrepancyWriteOff: { total: discrepancyWriteOffTotal, details: discrepancyDetails },
      // Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md
      // §5/§6) — purely additive fields; profitTotal/profitMargin/netProfit/
      // netProfitMargin above are unchanged in meaning and computation.
      cogs,
      grossProfit,
      grossProfitMargin,
      // All-time, not date-scoped — see the computation comment above.
      plantBalance,
      revenueByProduct,
      revenueByRoute,
      cashByVan,
      cashByPaymentType,
      revenueByPaymentType,
      collectionRate,
      outstandingBalance: customers._sum.financialBalance ?? 0,
      walkInCash,
      // Office Cash Ledger snapshot — `available` is the LIVE balance (never
      // date-scoped, see VanCashLedgerService.computeAvailableBalance); the
      // rest are scoped to the selected period like everything else here.
      // When `vanId` is set this is that ONE van's own cash-in-hand (not yet
      // handed to office), not the vendor-wide office pool — `scope` tells the
      // frontend which label to show.
      officeCash: {
        scope: vanId ? ('VAN' as const) : ('OFFICE' as const),
        available: officeCashStats.availableBalance,
        periodExpense: officeCashStats.totalExpense,
        periodCashIn: officeCashStats.totalCashIn,
        periodRemitted: officeCashStats.totalRemitted,
        pendingHandoverCount: officeCashStats.pendingHandoverCount,
        pendingRemittanceCount: officeCashStats.pendingRemittanceCount,
      },
      momGrowth,
      vanId: vanId ?? null,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getDeliveries(vendorId: string, from?: string, to?: string, vanId?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:deliveries:${from ?? ''}:${to ?? ''}:${vanId ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const [items, openIssues, resolvedIssues] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where: {
          // Voided items are struck from the operational record — they must not
          // count toward total / completionRate / byDay / DOW buckets.
          status: { not: 'VOIDED' },
          dailySheet: {
            vendorId,
            ...(dateFilter && { date: dateFilter }),
            ...(vanId && { vanId }),
          },
        },
        select: {
          status: true,
          deliveryType: true,
          reason: true,
          filledDropped: true,
          emptyReceived: true,
          filledReceived: true,
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
          ...(vanId && { dailySheetItem: { dailySheet: { vanId } } }),
        },
        select: { createdAt: true, status: true },
      }),
      this.prisma.deliveryIssue.findMany({
        where: {
          vendorId,
          status: 'RESOLVED',
          ...(dateFilter && { resolvedAt: dateFilter }),
          ...(vanId && { dailySheetItem: { dailySheet: { vanId } } }),
        },
        select: { resolution: true },
      }),
    ]);

    // Bottles currently sitting with customers, awaiting empty-return pickup
    // — a LIVE balance (BottleWallet.balance), not scoped to the selected
    // date range: it answers "how many empties do we need to collect right
    // now", not "how many were dropped in this period" (that's bottleStats
    // below, which IS period-scoped). Scoped to the van's currently-scheduled
    // customers when `vanId` is set (best-effort — see getCustomers comment).
    const bottlesOutstandingAgg = await this.prisma.bottleWallet.aggregate({
      where: { customer: { vendorId, ...(vanId && { deliverySchedules: { some: { vanId } } }) } },
      _sum: { balance: true },
    });
    const bottlesOutstanding = bottlesOutstandingAgg._sum.balance ?? 0;

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
      // dailySheet.route may be null (route-less per-van sheets) — don't crash.
      const route = item.dailySheet.route;
      const routeId = route?.id ?? 'unassigned';
      const entry = byRouteMap.get(routeId) ?? { routeName: route?.name ?? 'Unassigned', completed: 0, total: 0 };
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
    const missedItems = items.filter((i) => missedStatuses.has(i.status));
    const reasonMap = groupSum(missedItems, (i) => i.reason ?? i.status, () => 1);
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

    const completedItems = items.filter((i) => completedStatuses.has(i.status));
    const bottlesDelivered = completedItems.reduce((s, i) => s + i.filledDropped, 0);
    const bottlesReturned = completedItems.reduce((s, i) => s + i.emptyReceived, 0);
    const filledBottlesReturned = completedItems.reduce((s, i) => s + i.filledReceived, 0);

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
      bottleStats: {
        delivered: bottlesDelivered,
        returned: bottlesReturned,
        filledReturned: filledBottlesReturned,
        net: bottlesDelivered - bottlesReturned - filledBottlesReturned,
        // Live, not period-scoped — see query comment above.
        outstandingWithCustomers: bottlesOutstanding,
      },
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getCustomers(vendorId: string, from?: string, to?: string, vanId?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:customers:${from ?? ''}:${to ?? ''}:${vanId ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);
    // Customers don't carry a van directly — scoped via their CURRENT
    // delivery-schedule assignment when a van filter is active (best-effort:
    // a customer switching vans mid-period isn't reflected retroactively, and
    // this covers every summary/growth figure below since `allCustomers` is
    // the shared base for all of them).
    const customerVanScope = vanId ? { deliverySchedules: { some: { vanId } } } : {};

    const [allCustomers, newCustomers, topByRevenue, highestBalances] = await Promise.all([
      this.prisma.customer.findMany({
        where: { vendorId, ...customerVanScope },
        select: { id: true, isActive: true, paymentType: true, createdAt: true },
      }),
      this.prisma.customer.count({
        where: {
          vendorId,
          ...customerVanScope,
          ...(dateFilter && { createdAt: dateFilter }),
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['customerId'],
        where: {
          vendorId,
          type: TransactionType.DELIVERY,
          customerId: { not: null },
          // Same reasoning as getFinancial: filter by the sheet's business date.
          ...((dateFilter || vanId) && {
            dailySheet: { ...(dateFilter && { date: dateFilter }), ...(vanId && { vanId }) },
          }),
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      this.prisma.customer.findMany({
        where: { vendorId, financialBalance: { gt: 0 }, ...customerVanScope },
        select: { id: true, name: true, customerCode: true, financialBalance: true },
        orderBy: { financialBalance: 'desc' },
        take: 10,
      }),
    ]);

    // Deactivated this period — Customer has no deactivatedAt column, so this
    // is derived from the generic AuditLog (see CUSTOMER_DEACTIVATION_ACTIONS
    // doc comment at the top of the file). AuditLog carries no van relation,
    // so when van-scoped this narrows to `allCustomers`' own ids (already
    // scoped above) instead.
    const vanCustomerIds = vanId ? allCustomers.map((c) => c.id) : null;
    const deactivatedThisPeriod = await this.prisma.auditLog.count({
      where: {
        vendorId,
        entity: 'Customer',
        action: { in: CUSTOMER_DEACTIVATION_ACTIONS },
        ...(dateFilter && { createdAt: dateFilter }),
        ...(vanCustomerIds && { entityId: { in: vanCustomerIds } }),
      },
    });

    // Company losses — Force Deactivate write-offs (docs/customer force-deactivate:
    // an outstanding balance or held bottles on a force-closed account is posted
    // as a real `Transaction` (type ADJUSTMENT, description tagged "company loss"),
    // by BOTH the single (`deactivate`) and bulk (`bulkDeactivate`) force paths —
    // reading from Transaction (rather than re-parsing AuditLog's two differently-
    // shaped payloads) gives one consistent source for both. `amount` carries the
    // balance write-off (negative → magnitude taken below); `bottleCount` carries
    // the bottle write-off the same way; a given row is one or the other, never both.
    const writeOffRows = await this.prisma.transaction.findMany({
      where: {
        vendorId,
        type: TransactionType.ADJUSTMENT,
        description: { contains: 'company loss' },
        ...(dateFilter && { createdAt: dateFilter }),
        ...(vanCustomerIds && { customerId: { in: vanCustomerIds } }),
      },
      select: {
        id: true,
        amount: true,
        bottleCount: true,
        description: true,
        createdAt: true,
        customerId: true,
        customer: { select: { name: true, customerCode: true } },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    let balanceWriteOffTotal = 0;
    let bottleWriteOffTotal = 0;
    const writeOffDetails = writeOffRows.map((t) => {
      const isBalance = (t.description ?? '').startsWith('Bad-debt write-off');
      if (isBalance) balanceWriteOffTotal += Math.abs(t.amount ?? 0);
      else bottleWriteOffTotal += Math.abs(t.bottleCount ?? 0);
      return {
        id: t.id,
        date: t.createdAt,
        customerId: t.customerId,
        customerName: t.customer?.name ?? 'Unknown',
        customerCode: t.customer?.customerCode ?? null,
        type: isBalance ? ('BALANCE' as const) : ('BOTTLES' as const),
        amount: isBalance ? Math.abs(t.amount ?? 0) : 0,
        bottleCount: isBalance ? 0 : Math.abs(t.bottleCount ?? 0),
        product: t.product?.name ?? null,
      };
    });
    const companyLosses = {
      balanceWriteOffTotal: round2(balanceWriteOffTotal),
      bottleWriteOffTotal,
      // Full totals above are computed over every matching row; only the most
      // recent 25 are sent for the detail table so the payload stays bounded.
      details: writeOffDetails.slice(0, 25),
    };

    const total = allCustomers.length;
    const active = allCustomers.filter((c) => c.isActive).length;
    const inactive = total - active;
    // Active-only — a deactivated customer isn't being delivered to any more,
    // so counting them here would overstate the live cash/monthly mix.
    const cashCustomers = allCustomers.filter((c) => c.isActive && c.paymentType === PaymentType.CASH).length;
    const monthlyCustomers = allCustomers.filter((c) => c.isActive && c.paymentType === PaymentType.MONTHLY).length;
    // Retention rate — of customers that existed BEFORE this period started,
    // what fraction are still active today. Falls back to null (not 0/100)
    // when there's no "before the period" baseline to measure against, e.g.
    // an all-time query or a brand-new vendor.
    const existedBeforePeriod = from
      ? allCustomers.filter((c) => c.createdAt < new Date(from)).length
      : total - newCustomers;
    const retentionRate =
      existedBeforePeriod > 0
        ? Math.round(((existedBeforePeriod - deactivatedThisPeriod) / existedBeforePeriod) * 100)
        : null;

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
      summary: { total, active, inactive, newThisPeriod: newCustomers, deactivatedThisPeriod, retentionRate },
      paymentTypeBreakdown: { CASH: cashCustomers, MONTHLY: monthlyCustomers },
      growthByMonth,
      topByRevenue: topByRevenueEnriched,
      highestBalances,
      companyLosses,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getStaff(vendorId: string, from?: string, to?: string, vanId?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:staff:${from ?? ''}:${to ?? ''}:${vanId ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const sheets = await this.prisma.dailySheet.findMany({
      where: {
        vendorId,
        ...(dateFilter && { date: dateFilter }),
        ...(vanId && { vanId }),
      },
      include: {
        driver: { select: { id: true, name: true, role: true } },
        items: {
          // Voided items don't count toward a driver's delivery total,
          // completion rate or cash collected.
          where: { status: { not: 'VOIDED' } },
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

    // Attendance (owner-requested 2026-09-16) — StaffAttendance covers every
    // crew role (driver/salesman/loader), not just drivers, so it's fetched
    // and summarized independently of the driver-only `staff`/`sheets` above
    // rather than trying to force it onto that shape.
    const attendanceRows = await this.prisma.staffAttendance.findMany({
      where: {
        vendorId,
        ...(dateFilter && { date: dateFilter }),
        ...(vanId && { dailySheet: { vanId } }),
      },
      select: { userId: true, status: true, user: { select: { name: true, role: true } } },
    });
    const attendanceByUser = new Map<
      string,
      { name: string; role: string; present: number; absent: number; halfDay: number; leave: number; weeklyOff: number }
    >();
    for (const row of attendanceRows) {
      const entry = attendanceByUser.get(row.userId) ?? {
        name: row.user.name,
        role: row.user.role,
        present: 0,
        absent: 0,
        halfDay: 0,
        leave: 0,
        weeklyOff: 0,
      };
      if (row.status === 'PRESENT') entry.present++;
      else if (row.status === 'ABSENT') entry.absent++;
      else if (row.status === 'HALF_DAY') entry.halfDay++;
      else if (row.status === 'LEAVE') entry.leave++;
      else if (row.status === 'WEEKLY_OFF') entry.weeklyOff++;
      attendanceByUser.set(row.userId, entry);
    }
    // Attendance rate excludes WEEKLY_OFF from the denominator — a scheduled
    // off day isn't a work day to be present/absent against. Half days count
    // as half toward the numerator.
    const attendanceByStaff = Array.from(attendanceByUser.entries())
      .map(([userId, a]) => {
        const workDays = a.present + a.absent + a.halfDay + a.leave;
        return {
          userId,
          name: a.name,
          role: a.role,
          present: a.present,
          absent: a.absent,
          halfDay: a.halfDay,
          leave: a.leave,
          weeklyOff: a.weeklyOff,
          attendanceRate: workDays > 0 ? Math.round(((a.present + a.halfDay * 0.5) / workDays) * 100) : null,
        };
      })
      .sort((a, b) => (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1));

    const attendanceSummary = attendanceByStaff.reduce(
      (acc, a) => ({
        present: acc.present + a.present,
        absent: acc.absent + a.absent,
        halfDay: acc.halfDay + a.halfDay,
        leave: acc.leave + a.leave,
        weeklyOff: acc.weeklyOff + a.weeklyOff,
      }),
      { present: 0, absent: 0, halfDay: 0, leave: 0, weeklyOff: 0 },
    );
    const summaryWorkDays = attendanceSummary.present + attendanceSummary.absent + attendanceSummary.halfDay + attendanceSummary.leave;
    const overallAttendanceRate =
      summaryWorkDays > 0
        ? Math.round(((attendanceSummary.present + attendanceSummary.halfDay * 0.5) / summaryWorkDays) * 100)
        : null;

    const staff = Array.from(byDriver.values()).map(({ driver, sheets: driverSheets }) => {
      const allItems = driverSheets.flatMap((s) => s.items);
      const totalItems = allItems.length;
      const deliveredItems = allItems.filter((i) => completedStatuses.has(i.status)).length;
      const bottlesDelivered = allItems
        .filter((i) => completedStatuses.has(i.status))
        .reduce((s, i) => s + i.filledDropped, 0);
      const cashCollected = allItems.reduce((s, i) => s + i.cashCollected, 0);
      // Merge in this driver's own attendance counts, if any were recorded.
      const attendance = attendanceByUser.get(driver.id);
      return {
        userId: driver.id,
        name: driver.name,
        role: driver.role,
        deliveries: totalItems,
        completionRate: totalItems > 0 ? Math.round((deliveredItems / totalItems) * 100) : 0,
        cashCollected,
        bottlesDelivered,
        attendanceRate: attendance
          ? attendanceByStaff.find((a) => a.userId === driver.id)?.attendanceRate ?? null
          : null,
        absentDays: attendance?.absent ?? 0,
      };
    });

    staff.sort((a, b) => b.completionRate - a.completionRate);
    const result = {
      staff,
      leaderboard: staff,
      attendance: { byStaff: attendanceByStaff, summary: { ...attendanceSummary, overallAttendanceRate } },
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  /**
   * Operations tab (owner-requested 2026-09-16) — surfaces four modules that
   * previously had zero presence in Analytics: Fleet cost/efficiency, Damage
   * Cases, Customer Support Tickets, and WhatsApp Balance Reminders.
   */
  async getOperations(vendorId: string, from?: string, to?: string, vanId?: string) {
    const cacheKey = this.cache.vendorKey(
      vendorId,
      `${CACHE_KEYS.DASHBOARD}:analytics:operations:${from ?? ''}:${to ?? ''}:${vanId ?? ''}`,
    );
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const dateFilter = buildDateFilter(from, to);

    const [vans, fuelLogs, checks, maintenanceAgg, damageCases, tickets, reminderLogs] = await Promise.all([
      this.prisma.van.findMany({ where: { vendorId }, select: { id: true, plateNumber: true } }),
      // FuelLog.vehicleId, not vanId — attributed to a van via its sheet
      // (dailySheet.vanId) or, when logged off-sheet, the vehicle's usual van.
      this.prisma.fuelLog.findMany({
        where: { vendorId, ...(dateFilter && { date: dateFilter }) },
        select: {
          amountPaid: true,
          litersFilled: true,
          dailySheet: { select: { vanId: true } },
          vehicle: { select: { usualVanId: true } },
        },
      }),
      // Distance per van — same START/END odometer pairing as
      // vehicle-check.service.ts's per-vehicle history, aggregated by van
      // instead of by vehicle.
      this.prisma.vehicleDailyCheck.findMany({
        where: {
          vendorId,
          ...(vanId && { vanId }),
          dailySheet: { ...(dateFilter && { date: dateFilter }) },
        },
        select: { vanId: true, dailySheetId: true, checkType: true, odometerReading: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          category: ExpenseCategory.VEHICLE_MAINTENANCE,
          ...(dateFilter && { date: dateFilter }),
          ...(vanId && { vanId }),
        },
        _sum: { amount: true },
      }),
      // DamageCase has no direct vanId — only reachable via its (nullable)
      // linked DailySheetItem, so a van filter here narrows to damage cases
      // that were logged against an actual delivery stop.
      this.prisma.damageCase.findMany({
        where: {
          vendorId,
          ...(dateFilter && { createdAt: dateFilter }),
          ...(vanId && { dailySheetItem: { dailySheet: { vanId } } }),
        },
        select: { status: true, chargeAmount: true, bottleCount: true },
      }),
      // Customer support tickets aren't van-attributable — always vendor-wide.
      this.prisma.customerTicket.findMany({
        where: { vendorId, ...(dateFilter && { createdAt: dateFilter }) },
        select: { status: true, createdAt: true, resolvedAt: true },
      }),
      this.prisma.reminderSendLog.findMany({
        where: { vendorId, ...(dateFilter && { createdAt: dateFilter }), ...(vanId && { vanId }) },
        select: { sent: true, skipped: true },
      }),
    ]);

    const vanPlateMap = new Map(vans.map((v) => [v.id, v.plateNumber]));

    // ── Fleet: fuel cost + distance per van ──────────────────────────────
    const fuelByVanMap = new Map<string, { cost: number; liters: number }>();
    for (const f of fuelLogs) {
      const effVanId = f.dailySheet?.vanId ?? f.vehicle?.usualVanId ?? null;
      if (vanId && effVanId !== vanId) continue; // post-hoc filter — attribution needs the fallback above first
      const key = effVanId ?? 'unassigned';
      const entry = fuelByVanMap.get(key) ?? { cost: 0, liters: 0 };
      entry.cost += f.amountPaid;
      entry.liters += f.litersFilled;
      fuelByVanMap.set(key, entry);
    }

    const checksBySheet = new Map<string, { vanId: string; start?: number; end?: number }>();
    for (const c of checks) {
      const entry = checksBySheet.get(c.dailySheetId) ?? { vanId: c.vanId };
      if (c.checkType === 'START') entry.start = c.odometerReading;
      else if (c.checkType === 'END') entry.end = c.odometerReading;
      checksBySheet.set(c.dailySheetId, entry);
    }
    const distanceByVanMap = new Map<string, number>();
    for (const entry of checksBySheet.values()) {
      if (entry.start != null && entry.end != null && entry.end >= entry.start) {
        distanceByVanMap.set(entry.vanId, (distanceByVanMap.get(entry.vanId) ?? 0) + (entry.end - entry.start));
      }
    }

    const fleetVanIds = new Set([...fuelByVanMap.keys(), ...distanceByVanMap.keys()].filter((k) => k !== 'unassigned'));
    const fleetByVan = Array.from(fleetVanIds)
      .map((vId) => {
        const fuel = fuelByVanMap.get(vId) ?? { cost: 0, liters: 0 };
        const distanceKm = distanceByVanMap.get(vId) ?? 0;
        return {
          vanId: vId,
          plateNumber: vanPlateMap.get(vId) ?? 'Unknown',
          fuelCost: round2(fuel.cost),
          litersFilled: round2(fuel.liters),
          distanceKm,
          costPerKm: distanceKm > 0 ? round2(fuel.cost / distanceKm) : null,
          kmPerLiter: fuel.liters > 0 ? round2(distanceKm / fuel.liters) : null,
        };
      })
      .sort((a, b) => b.fuelCost - a.fuelCost);

    const unassignedFuelCost = fuelByVanMap.get('unassigned')?.cost ?? 0;
    const totalFuelCost = round2(fleetByVan.reduce((s, v) => s + v.fuelCost, 0) + unassignedFuelCost);
    const totalDistanceKm = fleetByVan.reduce((s, v) => s + v.distanceKm, 0);
    const totalMaintenanceCost = round2(maintenanceAgg._sum.amount ?? 0);

    const fleet = {
      totalFuelCost,
      totalMaintenanceCost,
      totalDistanceKm,
      overallCostPerKm: totalDistanceKm > 0 ? round2(totalFuelCost / totalDistanceKm) : null,
      byVan: fleetByVan,
    };

    // ── Damage Cases ──────────────────────────────────────────────────────
    const openDamageStatuses = new Set(['REPORTED', 'UNDER_REVIEW']);
    const damageOpen = damageCases.filter((d) => openDamageStatuses.has(d.status)).length;
    const damage = {
      total: damageCases.length,
      open: damageOpen,
      resolved: damageCases.length - damageOpen,
      totalBottles: damageCases.reduce((s, d) => s + d.bottleCount, 0),
      totalCharged: round2(damageCases.reduce((s, d) => s + (d.chargeAmount ?? 0), 0)),
    };

    // ── Customer Support Tickets ──────────────────────────────────────────
    const openTicketStatuses = new Set(['OPEN', 'IN_PROGRESS']);
    const ticketsOpen = tickets.filter((t) => openTicketStatuses.has(t.status)).length;
    const resolvedWithTimes = tickets.filter((t): t is typeof t & { resolvedAt: Date } => t.resolvedAt != null);
    const avgResolutionHours =
      resolvedWithTimes.length > 0
        ? Math.round(
            resolvedWithTimes.reduce((s, t) => s + (t.resolvedAt.getTime() - t.createdAt.getTime()), 0) /
              resolvedWithTimes.length /
              3_600_000,
          )
        : null;
    const supportTickets = {
      total: tickets.length,
      open: ticketsOpen,
      resolved: tickets.length - ticketsOpen,
      avgResolutionHours,
    };

    // ── WhatsApp Balance Reminders ─────────────────────────────────────────
    const reminders = {
      batches: reminderLogs.length,
      sent: reminderLogs.reduce((s, r) => s + r.sent, 0),
      skipped: reminderLogs.reduce((s, r) => s + r.skipped, 0),
    };

    const result = { fleet, damage, supportTickets, reminders };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }
}
