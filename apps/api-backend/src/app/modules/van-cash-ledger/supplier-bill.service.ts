import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory, ProductCostKind } from '@prisma/client';
import { currentPeriodLabel, periodBounds } from './cash-ledger-period.util';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SupplierBillBucket {
  /** Everything owed BEFORE this month, still unpaid after this month's payments
   *  are applied to it first (§ waterfall below). Can span more than one
   *  unpaid month — bucketed together, same convention as the customer-side
   *  `previousMonthOutstanding` (CustomerService.findAll). */
  prevMonthPending: number;
  /** This month's bill — system-calculated from deliveries × the applicable
   *  ProductCost rate (kind BOTTLE or CAP), same source as AnalyticsService's
   *  `cogs`/`capCogs`. Never reduced by payment here; see `currentMonthPending`. */
  currentMonthBill: number;
  /** `currentMonthBill` minus whatever of this month's payments was left over
   *  after clearing `prevMonthPending` first. */
  currentMonthPending: number;
  /** `prevMonthPending + currentMonthPending` — the amount a "Pay" action
   *  should default to if the office wants to fully settle both. */
  totalPending: number;
}

export interface SupplierBillStatus {
  periodLabel: string;
  plant: SupplierBillBucket;
  caps: SupplierBillBucket;
}

type CostRow = { productId: string; costPerUnit: number; effectiveFrom: Date; effectiveTo: Date | null };

/**
 * Month-wise Plant/Caps bill status (owner request 2026-09-22) — "how much is
 * left over from previous months vs. what this month's bill already comes to"
 * for the two recurring supplier bills the office pays: the water plant
 * (bottle refill cost) and the caps supplier. Same cost source as
 * AnalyticsService's `plantBalance`/`capBalance` (ProductCost × delivered
 * quantity), bucketed by calendar month (vendor/PKT timezone, via
 * cash-ledger-period.util — this module's own established convention)
 * instead of reported as one all-time running total.
 *
 * Payment waterfall (mirrors the already-established customer-side rule,
 * CustomerService.findAll's `previousMonthOutstanding`): a payment made this
 * month clears whatever was owed BEFORE this month first; only the leftover,
 * if any, reduces this month's own bill. Computed with signed arithmetic
 * (never floored mid-calculation) so an overpayment/advance correctly rolls
 * forward as a credit against the current month instead of being discarded —
 * see the worked comment on `computeBucket` below.
 */
@Injectable()
export class SupplierBillService {
  constructor(private readonly prisma: PrismaService) {}

  async getSupplierBillStatus(vendorId: string): Promise<SupplierBillStatus> {
    const periodLabel = currentPeriodLabel();
    const { startDate: curMonthStart } = periodBounds(periodLabel);

    const [
      deliveryItems,
      bottleCostRows,
      capCostRows,
      bottlePaidBeforeAgg,
      bottlePaidThisMonthAgg,
      capPaidBeforeAgg,
      capPaidThisMonthAgg,
    ] = await Promise.all([
      this.prisma.dailySheetItem.findMany({
        where: { status: { not: 'VOIDED' }, filledDropped: { gt: 0 }, dailySheet: { vendorId } },
        select: { productId: true, filledDropped: true, dailySheet: { select: { date: true } } },
      }),
      this.prisma.productCost.findMany({
        where: { vendorId, kind: ProductCostKind.BOTTLE, voidedAt: null },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.productCost.findMany({
        where: { vendorId, kind: ProductCostKind.CAP, voidedAt: null },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          category: { in: [ExpenseCategory.BOTTLE_PURCHASED, ExpenseCategory.BOTTLE_REFILL_PAYMENT] },
          date: { lt: curMonthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          category: { in: [ExpenseCategory.BOTTLE_PURCHASED, ExpenseCategory.BOTTLE_REFILL_PAYMENT] },
          date: { gte: curMonthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { vendorId, category: ExpenseCategory.CAPS_PURCHASED, date: { lt: curMonthStart } },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { vendorId, category: ExpenseCategory.CAPS_PURCHASED, date: { gte: curMonthStart } },
        _sum: { amount: true },
      }),
    ]);

    const buildLookup = (rows: CostRow[]) => {
      const byProduct = new Map<string, CostRow[]>();
      for (const c of rows) {
        const list = byProduct.get(c.productId) ?? [];
        list.push(c);
        byProduct.set(c.productId, list);
      }
      return (productId: string, date: Date) => {
        const list = byProduct.get(productId);
        if (!list) return null;
        let applicable: CostRow | null = null;
        for (const c of list) {
          if (c.effectiveFrom > date) break;
          if (c.effectiveTo && c.effectiveTo < date) continue;
          applicable = c;
        }
        return applicable;
      };
    };
    const findBottleCost = buildLookup(bottleCostRows);
    const findCapCost = buildLookup(capCostRows);

    let bottleCogsBefore = 0;
    let bottleCogsThisMonth = 0;
    let capCogsBefore = 0;
    let capCogsThisMonth = 0;
    for (const item of deliveryItems) {
      const date = item.dailySheet?.date ?? null;
      if (!date) continue;
      const isThisMonth = date.getTime() >= curMonthStart.getTime();

      const bottleCost = findBottleCost(item.productId, date);
      const bottleAmount = bottleCost ? item.filledDropped * bottleCost.costPerUnit : 0;
      if (isThisMonth) bottleCogsThisMonth += bottleAmount;
      else bottleCogsBefore += bottleAmount;

      const capCost = findCapCost(item.productId, date);
      const capAmount = capCost ? item.filledDropped * capCost.costPerUnit : 0;
      if (isThisMonth) capCogsThisMonth += capAmount;
      else capCogsBefore += capAmount;
    }

    const computeBucket = (cogsBefore: number, cogsThisMonth: number, paidBefore: number, paidThisMonth: number): SupplierBillBucket => {
      // Signed throughout (never floored mid-calculation) so an overpayment
      // that clears everything owed before this month correctly rolls the
      // leftover forward as a credit against THIS month's bill, rather than
      // being discarded. Worked example (the one the owner gave): prev bill
      // 1000, this month's bill 200, paid 1100 this month →
      // openingSigned=1000, remainingPrevSigned=1000-1100=-100 →
      // prevMonthPending=0, leftoverCredit=100, currentMonthPendingSigned=
      // 200-100=100 → currentMonthPending=100. Matches exactly.
      const openingSigned = cogsBefore - paidBefore;
      const remainingPrevSigned = openingSigned - paidThisMonth;
      const prevMonthPending = round2(Math.max(remainingPrevSigned, 0));
      const leftoverCredit = Math.max(-remainingPrevSigned, 0);
      const currentMonthPendingSigned = cogsThisMonth - leftoverCredit;
      const currentMonthPending = round2(Math.max(currentMonthPendingSigned, 0));
      return {
        prevMonthPending,
        currentMonthBill: round2(cogsThisMonth),
        currentMonthPending,
        totalPending: round2(prevMonthPending + currentMonthPending),
      };
    };

    return {
      periodLabel,
      plant: computeBucket(
        bottleCogsBefore,
        bottleCogsThisMonth,
        bottlePaidBeforeAgg._sum.amount ?? 0,
        bottlePaidThisMonthAgg._sum.amount ?? 0,
      ),
      caps: computeBucket(
        capCogsBefore,
        capCogsThisMonth,
        capPaidBeforeAgg._sum.amount ?? 0,
        capPaidThisMonthAgg._sum.amount ?? 0,
      ),
    };
  }
}
