import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import {
  LedgerEntryStatus,
  Prisma,
  StandaloneCrewCashStatus,
  StaffLedgerCategory,
  TransactionType,
} from '@prisma/client';
import {
  buildDomainTree,
  buildSummary,
  domainForKey,
  isExpenseCategoryKey,
  isProfitLossSourceKey,
  isValidMonth,
  labelForKey,
  monthRange,
  round2,
  shiftMonth,
  sumCategoryTotals,
  type CategoryTotal,
  type ProfitLossSourceKey,
  type SalesFigures,
} from './profit-loss.util';
import { vendorDateString } from '../../common/helpers/date.util';

const TREND_MONTHS = 6;
const CACHE_TTL_SECONDS = 60;
const DEFAULT_DETAIL_LIMIT = 20;

/** Cash-moving payroll advances — same classification as cash-ledger-buckets.ts (R6). */
const ADVANCE_CATEGORIES: StaffLedgerCategory[] = [
  StaffLedgerCategory.ADVANCE,
  StaffLedgerCategory.ADVANCE_DISBURSEMENT,
];

interface MonthFigures {
  sales: SalesFigures;
  categories: Map<ProfitLossSourceKey, CategoryTotal>;
  /** Customer payments split by how they reached us — the proof behind `amountReceived`. */
  received: {
    onSheets: { amount: number; count: number };
    recorded: Array<{ mode: string; amount: number; count: number }>;
  };
  /** Independent, ungrouped `Expense` table total — used only for the reconciliation check. */
  rawExpenseTableTotal: number;
}

export interface ProfitLossDetailRow {
  id: string;
  date: string;
  amount: number;
  title: string;
  subtitle: string | null;
  employeeName: string | null;
  vanPlateNumber: string | null;
  recordedByName: string | null;
  source: string;
  dailySheetId: string | null;
}

@Injectable()
export class ProfitLossService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // GET /analytics/profit-loss?month=YYYY-MM
  // ────────────────────────────────────────────────────────────────────────

  async getProfitLoss(vendorId: string, monthInput?: string) {
    const month = this.resolveMonth(monthInput);
    const cacheKey = this.cache.vendorKey(vendorId, `${CACHE_KEYS.DASHBOARD}:analytics:profit-loss:${month}`);
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(month, i - (TREND_MONTHS - 1)));
    const figuresByMonth = new Map<string, MonthFigures>();
    await Promise.all(
      trendMonths.map(async (m) => {
        figuresByMonth.set(m, await this.collectMonth(vendorId, m));
      }),
    );

    const current = figuresByMonth.get(month) as MonthFigures;
    const totalExpenses = sumCategoryTotals(current.categories);
    const domains = buildDomainTree(current.categories, current.sales.bottlesSold);

    // Reconciliation: the Expense table's own ungrouped total must equal the
    // sum of every Expense-sourced category leaf that landed in the tree. A gap
    // means a row escaped the grouping (should be impossible — kept as a loud
    // safety net, per the owner's "no expense may be missed" requirement).
    const treeExpenseTableTotal = domains
      .flatMap((d) => d.categories)
      .filter((c) => isExpenseCategoryKey(c.key))
      .reduce((s, c) => s + c.amount, 0);
    const difference = round2(current.rawExpenseTableTotal - treeExpenseTableTotal);

    const trend = trendMonths.map((m) => {
      const f = figuresByMonth.get(m) as MonthFigures;
      const expenses = sumCategoryTotals(f.categories);
      const tree = buildDomainTree(f.categories, f.sales.bottlesSold);
      return {
        month: m,
        ...buildSummary(f.sales, expenses),
        byDomain: Object.fromEntries(tree.map((d) => [d.domain, d.amount])),
      };
    });

    const result = {
      month,
      summary: buildSummary(current.sales, totalExpenses),
      receivedBreakdown: current.received,
      handoverReconciliation: await this.collectHandover(vendorId, month),
      domains,
      reconciliation: {
        expenseTableTotal: round2(current.rawExpenseTableTotal),
        groupedExpenseTableTotal: round2(treeExpenseTableTotal),
        difference,
        ok: Math.abs(difference) < 0.01,
      },
      trend,
    };

    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────
  // GET /analytics/profit-loss/details?month=&category=&page=&limit=
  // ────────────────────────────────────────────────────────────────────────

  async getDetails(vendorId: string, monthInput: string | undefined, category: string, page = 1, limit = DEFAULT_DETAIL_LIMIT) {
    const month = this.resolveMonth(monthInput);
    if (!isProfitLossSourceKey(category)) {
      throw new BadRequestException(`Unknown category: ${category}`);
    }
    const key = category;
    const { start, end } = monthRange(month);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    let rows: ProfitLossDetailRow[];
    let total: number;
    let count: number;

    if (isExpenseCategoryKey(key)) {
      const where: Prisma.ExpenseWhereInput = { vendorId, category: key, date: { gte: start, lte: end } };
      const [list, agg] = await Promise.all([
        this.prisma.expense.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
          select: {
            id: true,
            amount: true,
            description: true,
            date: true,
            paidFromCash: true,
            dailySheetId: true,
            van: { select: { plateNumber: true } },
            createdBy: { select: { name: true } },
            fuelLog: { select: { id: true } },
            vehicleServiceRecord: { select: { id: true } },
            extraLabour: { select: { name: true } },
          },
        }),
        this.prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      rows = list.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        amount: round2(e.amount),
        title: e.description || labelForKey(key),
        subtitle: e.paidFromCash ? null : 'Paid by card / bank',
        employeeName: e.extraLabour?.name ?? null,
        vanPlateNumber: e.van?.plateNumber ?? null,
        recordedByName: e.createdBy?.name ?? null,
        source: e.dailySheetId
          ? 'Daily Sheet'
          : e.fuelLog || e.vehicleServiceRecord
            ? 'Fleet'
            : 'Direct Expense',
        dailySheetId: e.dailySheetId,
      }));
      total = agg._sum.amount ?? 0;
      count = agg._count._all;
    } else if (key === 'SALARY_SETTLEMENT') {
      const where: Prisma.SettlementWhereInput = { vendorId, paidAt: { gte: start, lte: end } };
      const [list, agg] = await Promise.all([
        this.prisma.settlement.findMany({
          where,
          orderBy: { paidAt: 'desc' },
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
          select: {
            id: true,
            amount: true,
            method: true,
            referenceNote: true,
            paidAt: true,
            paidBy: { select: { name: true } },
            payrollEntry: { select: { user: { select: { name: true } }, period: { select: { periodLabel: true } } } },
          },
        }),
        this.prisma.settlement.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      rows = list.map((s) => ({
        id: s.id,
        date: s.paidAt.toISOString(),
        amount: round2(s.amount),
        title: `Salary — ${s.payrollEntry.period.periodLabel}`,
        subtitle: [s.method, s.referenceNote].filter(Boolean).join(' · ') || null,
        employeeName: s.payrollEntry.user.name,
        vanPlateNumber: null,
        recordedByName: s.paidBy?.name ?? null,
        source: 'Payroll',
        dailySheetId: null,
      }));
      total = agg._sum.amount ?? 0;
      count = agg._count._all;
    } else if (key === 'SALARY_ADVANCE') {
      const where = this.advanceWhere(vendorId, start, end);
      const [list, agg] = await Promise.all([
        this.prisma.staffLedgerEntry.findMany({
          where,
          orderBy: { effectiveDate: 'desc' },
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
          select: {
            id: true,
            amount: true,
            category: true,
            description: true,
            effectiveDate: true,
            user: { select: { name: true } },
            createdBy: { select: { name: true } },
          },
        }),
        this.prisma.staffLedgerEntry.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      rows = list.map((e) => ({
        id: e.id,
        date: e.effectiveDate.toISOString(),
        amount: round2(Math.abs(e.amount)),
        title: e.category === StaffLedgerCategory.ADVANCE_DISBURSEMENT ? 'Advance disbursed (installment plan)' : 'Salary advance',
        subtitle: e.description ?? null,
        employeeName: e.user.name,
        vanPlateNumber: null,
        recordedByName: e.createdBy?.name ?? null,
        source: 'Payroll',
        dailySheetId: null,
      }));
      total = Math.abs(agg._sum.amount ?? 0);
      count = agg._count._all;
    } else {
      // CREW_CASH — sheet-linked + standalone, merged newest-first.
      const sheetWhere: Prisma.CrewCashDistributionWhereInput = { vendorId, date: { gte: start, lte: end } };
      const standaloneWhere: Prisma.StandaloneCrewCashExpenseWhereInput = {
        vendorId,
        status: StandaloneCrewCashStatus.ACTIVE,
        date: { gte: start, lte: end },
      };
      // Bounded window per source: any row in the merged newest page*limit is
      // within its own source's newest page*limit.
      const window = safePage * safeLimit;
      const [sheetList, sheetAgg, standaloneList, standaloneAgg] = await Promise.all([
        this.prisma.crewCashDistribution.findMany({
          where: sheetWhere,
          orderBy: { date: 'desc' },
          take: window,
          select: {
            id: true,
            amount: true,
            category: true,
            notes: true,
            date: true,
            dailySheetId: true,
            employee: { select: { name: true } },
            distributedBy: { select: { name: true } },
            dailySheet: { select: { van: { select: { plateNumber: true } } } },
          },
        }),
        this.prisma.crewCashDistribution.aggregate({ where: sheetWhere, _sum: { amount: true }, _count: { _all: true } }),
        this.prisma.standaloneCrewCashExpense.findMany({
          where: standaloneWhere,
          orderBy: { date: 'desc' },
          take: window,
          select: {
            id: true,
            amount: true,
            category: true,
            notes: true,
            date: true,
            employee: { select: { name: true } },
            createdBy: { select: { name: true } },
          },
        }),
        this.prisma.standaloneCrewCashExpense.aggregate({
          where: standaloneWhere,
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);
      const merged: ProfitLossDetailRow[] = [
        ...sheetList.map((c) => ({
          id: c.id,
          date: c.date.toISOString(),
          amount: round2(c.amount),
          title: `Crew cash — ${humanize(c.category)}`,
          subtitle: c.notes ?? null,
          employeeName: c.employee.name,
          vanPlateNumber: c.dailySheet?.van?.plateNumber ?? null,
          recordedByName: c.distributedBy?.name ?? null,
          source: 'Daily Sheet',
          dailySheetId: c.dailySheetId,
        })),
        ...standaloneList.map((c) => ({
          id: c.id,
          date: c.date.toISOString(),
          amount: round2(c.amount),
          title: `Crew cash — ${humanize(c.category)}`,
          subtitle: c.notes ?? null,
          employeeName: c.employee.name,
          vanPlateNumber: null,
          recordedByName: c.createdBy?.name ?? null,
          source: 'Cash Ledger',
          dailySheetId: null,
        })),
      ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      rows = merged.slice((safePage - 1) * safeLimit, safePage * safeLimit);
      total = (sheetAgg._sum.amount ?? 0) + (standaloneAgg._sum.amount ?? 0);
      count = sheetAgg._count._all + standaloneAgg._count._all;
    }

    return {
      month,
      category: key,
      categoryLabel: labelForKey(key),
      domain: domainForKey(key),
      total: round2(total),
      meta: { total: count, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(count / safeLimit)) },
      rows,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // internals
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Proof that ties the gross customer receipts on delivery sheets to what the
   * drivers actually handed in (the figure the dashboard's sheet cash is built
   * from), using the SAME arithmetic as buildReconciliation in sheet-cash.util:
   *   expected hand-in = delivery cash recorded − cash expenses paid from the van − crew cash
   *   difference       = expected hand-in − actual hand-in (driver shortfall / post-close changes)
   * Everything is selected by the sheet's business date.
   */
  private async collectHandover(vendorId: string, month: string) {
    const { start, end } = monthRange(month);
    const sheetDate = { dailySheet: { date: { gte: start, lte: end } } };
    const [itemCash, vanExpenses, crewCash, handedIn] = await Promise.all([
      this.prisma.dailySheetItem.aggregate({
        where: { status: { not: 'VOIDED' }, dailySheet: { vendorId, date: { gte: start, lte: end } } },
        _sum: { cashCollected: true },
      }),
      this.prisma.expense.aggregate({
        where: { vendorId, paidFromCash: true, ...sheetDate },
        _sum: { amount: true },
      }),
      this.prisma.crewCashDistribution.aggregate({
        where: { vendorId, ...sheetDate },
        _sum: { amount: true },
      }),
      this.prisma.dailySheet.aggregate({
        where: { vendorId, date: { gte: start, lte: end } },
        _sum: { cashCollected: true },
        _count: { _all: true },
      }),
    ]);
    const deliveryCashRecorded = itemCash._sum.cashCollected ?? 0;
    const vanCashExpenses = vanExpenses._sum.amount ?? 0;
    const crewCashPaid = crewCash._sum.amount ?? 0;
    const expectedHandIn = Math.max(0, deliveryCashRecorded - vanCashExpenses - crewCashPaid);
    const actualHandedIn = handedIn._sum.cashCollected ?? 0;
    return {
      sheetCount: handedIn._count._all,
      deliveryCashRecorded: round2(deliveryCashRecorded),
      vanCashExpenses: round2(vanCashExpenses),
      crewCashPaid: round2(crewCashPaid),
      expectedHandIn: round2(expectedHandIn),
      actualHandedIn: round2(actualHandedIn),
      difference: round2(expectedHandIn - actualHandedIn),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // GET /analytics/profit-loss/payments?month=&kind=&page=&limit=
  // The proof behind "Amount Received": every payment, one row each.
  // kind: ALL | SHEET (collected on a delivery) | CASH | BANK_TRANSFER | CHEQUE (recorded payments)
  // ────────────────────────────────────────────────────────────────────────

  async getPayments(vendorId: string, monthInput: string | undefined, kind = 'ALL', page = 1, limit = DEFAULT_DETAIL_LIMIT) {
    const month = this.resolveMonth(monthInput);
    const { start, end } = monthRange(month);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const where: Prisma.TransactionWhereInput = {
      vendorId,
      type: TransactionType.PAYMENT,
      createdAt: { gte: start, lte: end },
    };
    if (kind === 'SHEET') where.dailySheetItemId = { not: null };
    else if (kind === 'CASH' || kind === 'BANK_TRANSFER' || kind === 'CHEQUE') {
      where.dailySheetItemId = null;
      where.paymentMode = kind;
    } else if (kind !== 'ALL') {
      throw new BadRequestException(`Unknown payment kind: ${kind}`);
    }

    const [list, agg] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          paymentMode: true,
          description: true,
          dailySheetId: true,
          dailySheetItemId: true,
          customer: { select: { name: true, customerCode: true } },
        },
      }),
      this.prisma.transaction.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const count = agg._count._all;
    return {
      month,
      kind,
      total: round2(-(agg._sum.amount ?? 0)),
      meta: { total: count, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(count / safeLimit)) },
      rows: list.map((t) => ({
        id: t.id,
        date: t.createdAt.toISOString(),
        amount: round2(Math.abs(t.amount ?? 0)),
        customerName: t.customer?.name ?? null,
        customerCode: t.customer?.customerCode ?? null,
        mode: t.dailySheetItemId ? 'Collected on delivery' : (t.paymentMode ?? 'UNSPECIFIED'),
        description: t.description ?? null,
        dailySheetId: t.dailySheetId,
      })),
    };
  }

  private resolveMonth(input?: string): string {
    if (!input) return vendorDateString(new Date()).slice(0, 7);
    if (!isValidMonth(input)) throw new BadRequestException('month must be in YYYY-MM format');
    return input;
  }

  private advanceWhere(vendorId: string, start: Date, end: Date): Prisma.StaffLedgerEntryWhereInput {
    return {
      vendorId,
      category: { in: ADVANCE_CATEGORIES },
      status: LedgerEntryStatus.POSTED,
      amount: { lt: 0 },
      effectiveDate: { gte: start, lte: end },
    };
  }

  /** Every figure for one calendar month (vendor/PKT). Company-wide — no van scope by design. */
  private async collectMonth(vendorId: string, month: string): Promise<MonthFigures> {
    const { start, end } = monthRange(month);
    const range = { gte: start, lte: end };

    const [
      saleAgg,
      paymentAgg,
      sheetPaymentAgg,
      recordedByMode,
      expenseGroups,
      rawExpenseAgg,
      settlementAgg,
      advanceAgg,
      sheetCrewAgg,
      standaloneCrewAgg,
    ] = await Promise.all([
      // Sale — same set the Financial tab uses: DELIVERY rows bucketed by the
      // sheet's business date. Bottles are net of filled bottles taken back,
      // matching how the charge itself is netted.
      this.prisma.transaction.aggregate({
        where: { vendorId, type: TransactionType.DELIVERY, dailySheet: { date: range } },
        _sum: { amount: true, filledDropped: true, filledReceived: true },
      }),
      // Amount Received — EVERY payment recorded in the month: in-delivery cash
      // (written as a PAYMENT row per item) and manually recorded / portal
      // payments alike. PAYMENT rows are stored negative. Deleted payments are
      // hard-deleted, so nothing needs netting out.
      this.prisma.transaction.aggregate({
        where: { vendorId, type: TransactionType.PAYMENT, createdAt: range },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { vendorId, type: TransactionType.PAYMENT, createdAt: range, dailySheetItemId: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Payments NOT tied to a delivery line (dashboard Record Payment, portal/online),
      // split by payment mode.
      this.prisma.transaction.groupBy({
        by: ['paymentMode'],
        where: { vendorId, type: TransactionType.PAYMENT, createdAt: range, dailySheetItemId: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { vendorId, date: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.aggregate({ where: { vendorId, date: range }, _sum: { amount: true } }),
      this.prisma.settlement.aggregate({
        where: { vendorId, paidAt: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.staffLedgerEntry.aggregate({
        where: this.advanceWhere(vendorId, start, end),
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.crewCashDistribution.aggregate({
        where: { vendorId, date: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.standaloneCrewCashExpense.aggregate({
        where: { vendorId, status: StandaloneCrewCashStatus.ACTIVE, date: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const categories = new Map<ProfitLossSourceKey, CategoryTotal>();
    for (const g of expenseGroups) {
      categories.set(g.category, { amount: g._sum.amount ?? 0, count: g._count._all });
    }
    categories.set('SALARY_SETTLEMENT', { amount: settlementAgg._sum.amount ?? 0, count: settlementAgg._count._all });
    categories.set('SALARY_ADVANCE', { amount: Math.abs(advanceAgg._sum.amount ?? 0), count: advanceAgg._count._all });
    categories.set('CREW_CASH', {
      amount: (sheetCrewAgg._sum.amount ?? 0) + (standaloneCrewAgg._sum.amount ?? 0),
      count: sheetCrewAgg._count._all + standaloneCrewAgg._count._all,
    });

    return {
      sales: {
        bottlesDelivered: saleAgg._sum.filledDropped ?? 0,
        filledReturned: saleAgg._sum.filledReceived ?? 0,
        receivedOnSheets: -(sheetPaymentAgg._sum.amount ?? 0),
        receivedRecorded: -((paymentAgg._sum.amount ?? 0) - (sheetPaymentAgg._sum.amount ?? 0)),
        bottlesSold: (saleAgg._sum.filledDropped ?? 0) - (saleAgg._sum.filledReceived ?? 0),
        saleAmount: saleAgg._sum.amount ?? 0,
        amountReceived: -(paymentAgg._sum.amount ?? 0),
      },
      categories,
      received: {
        onSheets: { amount: -(sheetPaymentAgg._sum.amount ?? 0), count: sheetPaymentAgg._count._all },
        recorded: recordedByMode.map((g) => ({
          mode: g.paymentMode ?? 'UNSPECIFIED',
          amount: -(g._sum.amount ?? 0),
          count: g._count._all,
        })),
      },
      rawExpenseTableTotal: rawExpenseAgg._sum.amount ?? 0,
    };
  }
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
