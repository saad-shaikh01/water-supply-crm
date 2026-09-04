import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory, LedgerEntryStatus, Prisma, StaffLedgerCategory } from '@prisma/client';
import { paginate, type PaginatedResult } from '../../common/helpers/paginate';
import {
  ExpenseCenterSummaryQueryDto,
  ExpenseCenterTimelineQueryDto,
} from './dto/expense-center-query.dto';
import {
  CREW_CASH_CATEGORY,
  EXPENSE_CENTER_DOMAINS,
  compareRowsByDateDesc,
  domainForExpenseCategory,
  labelForExpenseCategory,
  labelForStaffLedgerCategory,
  normalizeCrewCashRow,
  normalizeExpenseRow,
  normalizeStaffLedgerRow,
  resolveSourceSelection,
  STAFF_LEDGER_CATEGORY_LABELS,
  type ExpenseCenterDomain,
  type ExpenseCenterRow,
} from './expense-center-domain.util';

export interface ExpenseCenterSummary {
  totalSpend: number;
  cashAmount: number;
  cardAmount: number;
  cashPercent: number;
  cardPercent: number;
  topCategory: { category: string; label: string; amount: number } | null;
  /** vs the immediately preceding period of equal length; null when that period had zero spend. */
  momDeltaPercent: number | null;
  byDomain: Array<{ domain: ExpenseCenterDomain; amount: number; percent: number }>;
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentOf(amount: number, total: number): number {
  if (total <= 0) return 0;
  return round1((amount / total) * 100);
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Same `from`/`to` widening convention as ExpenseService.findAll / AnalyticsService. */
function buildDateFilter(from?: Date, to?: Date): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return filter;
}

interface PeriodTotals {
  expenseByCategory: Map<ExpenseCategory, number>;
  expenseCash: number;
  expenseCard: number;
  staffLedgerByCategory: Map<StaffLedgerCategory, number>;
  staffLedgerTotal: number;
  crewCashTotal: number;
  total: number;
}

/**
 * Expense Center — Phase 1, read-only orchestration over the three sources that
 * between them cover every expense-recording surface exactly once (see the
 * header of expense-center-domain.util.ts for why it is three and not five).
 *
 * Nothing here writes. Every existing recording surface keeps its own module;
 * this one only reads and merges.
 */
@Injectable()
export class ExpenseCenterService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────
  // GET /expense-center/summary
  // ────────────────────────────────────────────────────────────────────────

  async getSummary(vendorId: string, query: ExpenseCenterSummaryQueryDto): Promise<ExpenseCenterSummary> {
    const { start, end } = resolvePeriod(query.from, query.to);

    // Prior period of EQUAL LENGTH ending the instant before this one starts —
    // so a 7-day range compares against the previous 7 days, not the previous
    // calendar month.
    const lengthMs = end.getTime() - start.getTime();
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - lengthMs);

    const [current, previous] = await Promise.all([
      this.collectPeriodTotals(vendorId, start, end),
      this.collectPeriodTotals(vendorId, previousStart, previousEnd),
    ]);

    const totalSpend = round2(current.total);

    // Cash/card split: only `Expense` carries a paidFromCash flag. ASSUMPTION
    // (documented, not derived from data): every StaffLedgerEntry and every
    // CrewCashDistribution counts as CASH, because neither model records a
    // payment instrument at all — crew cash is by definition handed over as
    // physical van cash, and payroll ledger movements settle through the
    // payroll run rather than a card. If a card/bank payroll instrument is
    // ever modelled, this split must be revisited.
    const cashAmount = round2(current.expenseCash + current.staffLedgerTotal + current.crewCashTotal);
    const cardAmount = round2(current.expenseCard);

    return {
      totalSpend,
      cashAmount,
      cardAmount,
      cashPercent: percentOf(cashAmount, totalSpend),
      cardPercent: percentOf(cardAmount, totalSpend),
      topCategory: pickTopCategory(current),
      momDeltaPercent:
        previous.total > 0 ? round1(((current.total - previous.total) / previous.total) * 100) : null,
      byDomain: buildDomainBreakdown(current, totalSpend),
    };
  }

  /**
   * One period's numbers from all three sources.
   *
   * The StaffLedgerEntry read pulls rows rather than a groupBy because
   * `amount` is SIGNED there and a cost report needs SUM(ABS(amount)) — which
   * Prisma's groupBy cannot express, and which is NOT the same as
   * ABS(SUM(amount)) once a period mixes credits and debits. Payroll ledger
   * volume per period is bounded by (employees x entries), i.e. tens-to-
   * hundreds of rows, so this is cheap; a materialized rollup is the
   * documented next step if that ever stops being true.
   */
  private async collectPeriodTotals(vendorId: string, start: Date, end: Date): Promise<PeriodTotals> {
    const [expenseGroups, ledgerRows, crewCashAgg] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category', 'paidFromCash'],
        where: { vendorId, date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      this.prisma.staffLedgerEntry.findMany({
        where: {
          vendorId,
          // CREW_CASH entries are the synced copies of CrewCashDistribution
          // rows, which are read directly below — counting both would double
          // every closed sheet's crew cash.
          category: { not: StaffLedgerCategory.CREW_CASH },
          // A VOIDED entry was cancelled and is excluded from the payroll
          // engine's own computation too — it is not money the business spent.
          status: { not: LedgerEntryStatus.VOIDED },
          effectiveDate: { gte: start, lte: end },
        },
        select: { category: true, amount: true },
      }),
      this.prisma.crewCashDistribution.aggregate({
        where: { vendorId, date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
    ]);

    const expenseByCategory = new Map<ExpenseCategory, number>();
    let expenseCash = 0;
    let expenseCard = 0;
    for (const group of expenseGroups) {
      const amount = group._sum.amount ?? 0;
      expenseByCategory.set(group.category, (expenseByCategory.get(group.category) ?? 0) + amount);
      if (group.paidFromCash) expenseCash += amount;
      else expenseCard += amount;
    }

    const staffLedgerByCategory = new Map<StaffLedgerCategory, number>();
    let staffLedgerTotal = 0;
    for (const row of ledgerRows) {
      const amount = Math.abs(row.amount);
      staffLedgerByCategory.set(row.category, (staffLedgerByCategory.get(row.category) ?? 0) + amount);
      staffLedgerTotal += amount;
    }

    const crewCashTotal = crewCashAgg._sum.amount ?? 0;

    return {
      expenseByCategory,
      expenseCash,
      expenseCard,
      staffLedgerByCategory,
      staffLedgerTotal,
      crewCashTotal,
      total: expenseCash + expenseCard + staffLedgerTotal + crewCashTotal,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // GET /expense-center/timeline
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Merged, date-descending, paginated timeline.
   *
   * SORT-THEN-PAGE STRATEGY: the three sources cannot be joined in SQL, so each
   * is queried for a BOUNDED window of its own newest `page * limit + limit`
   * rows, the windows are merge-sorted, and the requested page is sliced out.
   * That window is provably sufficient: any row belonging to the global newest
   * `page * limit` must also be within its own source's newest `page * limit`.
   * `meta.total` still comes from exact per-source COUNTs, so it is never an
   * approximation. If this ever needs to scale past what a bounded window can
   * serve comfortably, the documented next step is a materialized expense
   * rollup table written by each source on create — not a bigger window.
   */
  async getTimeline(
    vendorId: string,
    query: ExpenseCenterTimelineQueryDto,
  ): Promise<PaginatedResult<ExpenseCenterRow>> {
    const { page = 1, limit = 20 } = query;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? endOfDay(new Date(query.to)) : undefined;
    const dateFilter = buildDateFilter(from, to);

    const selection = resolveSourceSelection({
      domain: query.domain,
      category: query.category,
      vanId: query.vanId,
      employeeId: query.employeeId,
      paymentMethod: query.paymentMethod,
    });

    const windowSize = page * limit + limit;

    const expenseWhere: Prisma.ExpenseWhereInput = {
      vendorId,
      ...(dateFilter && { date: dateFilter }),
      ...(selection.expenseCategories && { category: { in: selection.expenseCategories } }),
      ...(query.vanId && { vanId: query.vanId }),
      // card == paidFromCash false; cash == paidFromCash true.
      ...(query.paymentMethod && { paidFromCash: query.paymentMethod === 'CASH' }),
    };

    const ledgerWhere: Prisma.StaffLedgerEntryWhereInput = {
      vendorId,
      category: selection.staffLedgerCategories
        ? { in: selection.staffLedgerCategories }
        : { not: StaffLedgerCategory.CREW_CASH },
      status: { not: LedgerEntryStatus.VOIDED },
      ...(dateFilter && { effectiveDate: dateFilter }),
      ...(query.employeeId && { userId: query.employeeId }),
    };

    const crewCashWhere: Prisma.CrewCashDistributionWhereInput = {
      vendorId,
      ...(dateFilter && { date: dateFilter }),
      ...(query.employeeId && { employeeId: query.employeeId }),
      // Crew cash has no vanId of its own — it inherits the parent sheet's van.
      ...(query.vanId && { dailySheet: { vanId: query.vanId } }),
    };

    const [expenseRows, expenseCount, ledgerRows, ledgerCount, crewCashRows, crewCashCount] =
      await Promise.all([
        selection.includeExpenses
          ? this.prisma.expense.findMany({
              where: expenseWhere,
              select: {
                id: true,
                category: true,
                amount: true,
                paidFromCash: true,
                description: true,
                date: true,
                dailySheetId: true,
                // Presence-only joins — they decide the "via Fleet" badge and
                // keep provenance a single query instead of a per-row lookup.
                fuelLog: { select: { id: true } },
                vehicleServiceRecord: { select: { id: true } },
                van: { select: { plateNumber: true } },
                createdBy: { select: { name: true } },
                dailySheet: { select: { isClosed: true } },
              },
              orderBy: { date: 'desc' },
              take: windowSize,
            })
          : [],
        selection.includeExpenses ? this.prisma.expense.count({ where: expenseWhere }) : 0,
        selection.includeStaffLedger
          ? this.prisma.staffLedgerEntry.findMany({
              where: ledgerWhere,
              select: {
                id: true,
                category: true,
                amount: true,
                description: true,
                effectiveDate: true,
                user: { select: { name: true } },
                createdBy: { select: { name: true } },
                payrollEntryId: true,
              },
              orderBy: { effectiveDate: 'desc' },
              take: windowSize,
            })
          : [],
        selection.includeStaffLedger ? this.prisma.staffLedgerEntry.count({ where: ledgerWhere }) : 0,
        selection.includeCrewCash
          ? this.prisma.crewCashDistribution.findMany({
              where: crewCashWhere,
              select: {
                id: true,
                category: true,
                amount: true,
                notes: true,
                date: true,
                dailySheetId: true,
                employee: { select: { name: true } },
                distributedBy: { select: { name: true } },
                dailySheet: { select: { van: { select: { plateNumber: true } } } },
                syncedAt: true,
              },
              orderBy: { date: 'desc' },
              take: windowSize,
            })
          : [],
        selection.includeCrewCash ? this.prisma.crewCashDistribution.count({ where: crewCashWhere }) : 0,
      ]);

    const merged: ExpenseCenterRow[] = [];
    for (const row of expenseRows) merged.push(normalizeExpenseRow(row));
    for (const row of ledgerRows) merged.push(normalizeStaffLedgerRow(row));
    for (const row of crewCashRows) merged.push(normalizeCrewCashRow(row));
    merged.sort(compareRowsByDateDesc);

    const total = expenseCount + ledgerCount + crewCashCount;
    const skip = (page - 1) * limit;

    return paginate(merged.slice(skip, skip + limit), total, page, limit);
  }
}

/**
 * Range resolution. Both omitted -> the current calendar month (the convention
 * the Expense pages already present to the user). `from` alone runs to the end
 * of today; `to` alone starts at the beginning of that date's month.
 */
function resolvePeriod(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date();

  if (from && to) {
    return { start: new Date(from), end: endOfDay(new Date(to)) };
  }
  if (from) {
    return { start: new Date(from), end: endOfDay(now) };
  }

  const anchor = to ? new Date(to) : now;
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
  const end = to
    ? endOfDay(new Date(to))
    : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);

  return { start, end };
}

/** Highest-amount single category across the merged set (Expense + ledger + crew cash). */
function pickTopCategory(totals: PeriodTotals): ExpenseCenterSummary['topCategory'] {
  const candidates: Array<{ category: string; label: string; amount: number }> = [];

  for (const [category, amount] of totals.expenseByCategory) {
    candidates.push({ category, label: labelForExpenseCategory(category), amount: round2(amount) });
  }
  for (const [category, amount] of totals.staffLedgerByCategory) {
    candidates.push({ category, label: labelForStaffLedgerCategory(category), amount: round2(amount) });
  }
  if (totals.crewCashTotal > 0) {
    candidates.push({
      category: CREW_CASH_CATEGORY,
      label: STAFF_LEDGER_CATEGORY_LABELS.CREW_CASH,
      amount: round2(totals.crewCashTotal),
    });
  }

  const positive = candidates.filter((candidate) => candidate.amount > 0);
  if (positive.length === 0) return null;

  return positive.reduce((best, candidate) => (candidate.amount > best.amount ? candidate : best));
}

/** All six domains always emitted (CAPITAL has no live source yet — see the util header). */
function buildDomainBreakdown(
  totals: PeriodTotals,
  totalSpend: number,
): ExpenseCenterSummary['byDomain'] {
  const byDomain = new Map<ExpenseCenterDomain, number>(
    EXPENSE_CENTER_DOMAINS.map((domain): [ExpenseCenterDomain, number] => [domain, 0]),
  );

  for (const [category, amount] of totals.expenseByCategory) {
    const domain = domainForExpenseCategory(category);
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + amount);
  }

  // Every payroll-sourced row — ledger entries and crew cash alike — is EMPLOYEES.
  byDomain.set(
    'EMPLOYEES',
    (byDomain.get('EMPLOYEES') ?? 0) + totals.staffLedgerTotal + totals.crewCashTotal,
  );

  return EXPENSE_CENTER_DOMAINS.map((domain) => {
    const amount = round2(byDomain.get(domain) ?? 0);
    return { domain, amount, percent: percentOf(amount, totalSpend) };
  });
}
