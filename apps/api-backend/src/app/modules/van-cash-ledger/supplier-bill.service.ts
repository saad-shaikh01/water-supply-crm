import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { ExpenseCategory, ProductCostKind } from '@prisma/client';
import { currentPeriodLabel, periodBounds } from './cash-ledger-period.util';
import { AuditService } from '../audit/audit.service';
import { SetSupplierBillOpeningBalanceDto } from './dto/set-supplier-bill-opening-balance.dto';
import type { AuthUser } from '@water-supply-crm/types';

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
  /** Bottles delivered before this month that had a covering cost row (i.e.
   *  actually counted into `prevMonthPending`'s originating bill) — owner
   *  request 2026-09-23, so the pending amount is never just a bare number. */
  prevMonthBottles: number;
  /** Bottles delivered this month that had a covering cost row (i.e. actually
   *  counted into `currentMonthBill`). */
  currentMonthBottles: number;
  /** The bucket's manually-seeded pre-tracking debt (owner request 2026-09-25),
   *  already folded into `prevMonthPending` above — surfaced separately so the
   *  breakdown is never a bare unexplained number. 0 when never set. */
  openingBalance: number;
}

export interface SupplierBillStatus {
  periodLabel: string;
  plant: SupplierBillBucket;
  caps: SupplierBillBucket;
}

export interface SupplierBillOpeningBalance {
  plantAmount: number;
  capsAmount: number;
  note: string | null;
  updatedAt: string | null;
}

type CostRow = { productId: string; costPerUnit: number; effectiveFrom: Date; effectiveTo: Date | null };

/** Per-product cost lookup: the ProductCost row applicable on a given delivery date (rows sorted by effectiveFrom asc). */
function buildCostLookup(rows: CostRow[]) {
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
}

/** What the P&L "actual cost" view needs to know about one supplier bill for a month, as of that month's end. */
export interface SupplierMonthAccrual {
  /** The month's own system-calculated bill (deliveries x ProductCost). */
  bill: number;
  /** Cash paid to the supplier during the month (towards any month's bill). */
  paidInMonth: number;
  /** Part of paidInMonth that cleared bills of EARLIER months (oldest debt first). */
  priorPaid: number;
  /** Part of the month's bill still unpaid at month end. */
  pending: number;
}

export interface SupplierMonthAccrualResult {
  plant: SupplierMonthAccrual;
  caps: SupplierMonthAccrual;
}

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
 *
 * Opening balance (owner request 2026-09-25): a vendor who starts using the
 * software mid-way through their real business has no in-system delivery
 * history for whatever they already owed the supplier before tracking began —
 * `cogsBefore` computes to 0 for that debt, so a payment recorded to settle it
 * would otherwise be wrongly netted against the system-calculated CURRENT
 * month's bill. `SupplierBillOpeningBalance` (one editable row per vendor, via
 * `setOpeningBalance`) seeds that pre-tracking debt; it's added straight into
 * `cogsBefore` ahead of the waterfall so it's cleared first, exactly like any
 * other backlog, and — because `paidBefore` keeps accumulating every actual
 * month that passes — it drains down and stays cleared on its own with no
 * separate "remaining balance" bookkeeping needed.
 */
@Injectable()
export class SupplierBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOpeningBalance(vendorId: string): Promise<SupplierBillOpeningBalance> {
    const row = await this.prisma.supplierBillOpeningBalance.findUnique({ where: { vendorId } });
    return {
      plantAmount: row?.plantAmount ?? 0,
      capsAmount: row?.capsAmount ?? 0,
      note: row?.note ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async setOpeningBalance(
    user: AuthUser,
    dto: SetSupplierBillOpeningBalanceDto,
  ): Promise<SupplierBillOpeningBalance> {
    const before = await this.prisma.supplierBillOpeningBalance.findUnique({ where: { vendorId: user.vendorId } });

    const row = await this.prisma.supplierBillOpeningBalance.upsert({
      where: { vendorId: user.vendorId },
      create: {
        vendorId: user.vendorId,
        plantAmount: dto.plantAmount,
        capsAmount: dto.capsAmount,
        note: dto.note ?? null,
      },
      update: {
        plantAmount: dto.plantAmount,
        capsAmount: dto.capsAmount,
        note: dto.note ?? null,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: before ? 'UPDATED' : 'CREATED',
      entity: 'SupplierBillOpeningBalance',
      entityId: row.id,
      changes: {
        before: before ? { plantAmount: before.plantAmount, capsAmount: before.capsAmount, note: before.note } : null,
        after: { plantAmount: row.plantAmount, capsAmount: row.capsAmount, note: row.note },
      },
    });

    return {
      plantAmount: row.plantAmount,
      capsAmount: row.capsAmount,
      note: row.note,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Plant/Caps bill position for ANY calendar month, as of that month's end —
   * feeds the Profit & Loss "actual cost" view. Same cost source and the same
   * oldest-debt-first payment waterfall as getSupplierBillStatus, but bounded
   * to the month: deliveries and payments after it are ignored, so a past month
   * always reads the same no matter when it is viewed.
   */
  async getMonthAccrual(vendorId: string, month: string): Promise<SupplierMonthAccrualResult> {
    const { startDate, endDate } = periodBounds(month);
    const bottleCategories = [ExpenseCategory.BOTTLE_PURCHASED, ExpenseCategory.BOTTLE_REFILL_PAYMENT];
    const capCategories = [ExpenseCategory.CAPS_PURCHASED];

    const sumPaid = async (categories: ExpenseCategory[], date: { lt?: Date; gte?: Date; lte?: Date }) =>
      (
        await this.prisma.expense.aggregate({
          where: { vendorId, category: { in: categories }, date },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0;

    const [deliveryItems, bottleCostRows, capCostRows, openingBalance, bottlePaidBefore, bottlePaidMonth, capPaidBefore, capPaidMonth] =
      await Promise.all([
        this.prisma.dailySheetItem.findMany({
          where: { status: { not: 'VOIDED' }, filledDropped: { gt: 0 }, dailySheet: { vendorId, date: { lte: endDate } } },
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
        this.prisma.supplierBillOpeningBalance.findUnique({ where: { vendorId } }),
        sumPaid(bottleCategories, { lt: startDate }),
        sumPaid(bottleCategories, { gte: startDate, lte: endDate }),
        sumPaid(capCategories, { lt: startDate }),
        sumPaid(capCategories, { gte: startDate, lte: endDate }),
      ]);

    const findBottleCost = buildCostLookup(bottleCostRows);
    const findCapCost = buildCostLookup(capCostRows);
    let bottleBefore = 0;
    let bottleMonth = 0;
    let capBefore = 0;
    let capMonth = 0;
    for (const item of deliveryItems) {
      const date = item.dailySheet?.date ?? null;
      if (!date) continue;
      const inMonth = date.getTime() >= startDate.getTime();
      const bottleCost = findBottleCost(item.productId, date);
      if (bottleCost) {
        const amount = item.filledDropped * bottleCost.costPerUnit;
        if (inMonth) bottleMonth += amount;
        else bottleBefore += amount;
      }
      const capCost = findCapCost(item.productId, date);
      if (capCost) {
        const amount = item.filledDropped * capCost.costPerUnit;
        if (inMonth) capMonth += amount;
        else capBefore += amount;
      }
    }

    // Signed throughout, like computeBucket: an overpayment of earlier bills
    // rolls forward as a credit against this month's bill.
    const accrue = (cogsBefore: number, cogsMonth: number, paidBefore: number, paidMonth: number, opening: number): SupplierMonthAccrual => {
      const openingSigned = cogsBefore + opening - paidBefore;
      const leftoverCredit = Math.max(-(openingSigned - paidMonth), 0);
      return {
        bill: round2(cogsMonth),
        paidInMonth: round2(paidMonth),
        priorPaid: round2(Math.min(paidMonth, Math.max(openingSigned, 0))),
        pending: round2(Math.max(cogsMonth - leftoverCredit, 0)),
      };
    };

    return {
      plant: accrue(bottleBefore, bottleMonth, bottlePaidBefore, bottlePaidMonth, openingBalance?.plantAmount ?? 0),
      caps: accrue(capBefore, capMonth, capPaidBefore, capPaidMonth, openingBalance?.capsAmount ?? 0),
    };
  }

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
      openingBalance,
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
      this.prisma.supplierBillOpeningBalance.findUnique({ where: { vendorId } }),
    ]);

    const findBottleCost = buildCostLookup(bottleCostRows);
    const findCapCost = buildCostLookup(capCostRows);

    let bottleCogsBefore = 0;
    let bottleCogsThisMonth = 0;
    let bottleQtyBefore = 0;
    let bottleQtyThisMonth = 0;
    let capCogsBefore = 0;
    let capCogsThisMonth = 0;
    let capQtyBefore = 0;
    let capQtyThisMonth = 0;
    for (const item of deliveryItems) {
      const date = item.dailySheet?.date ?? null;
      if (!date) continue;
      const isThisMonth = date.getTime() >= curMonthStart.getTime();

      const bottleCost = findBottleCost(item.productId, date);
      if (bottleCost) {
        const bottleAmount = item.filledDropped * bottleCost.costPerUnit;
        if (isThisMonth) { bottleCogsThisMonth += bottleAmount; bottleQtyThisMonth += item.filledDropped; }
        else { bottleCogsBefore += bottleAmount; bottleQtyBefore += item.filledDropped; }
      }

      const capCost = findCapCost(item.productId, date);
      if (capCost) {
        const capAmount = item.filledDropped * capCost.costPerUnit;
        if (isThisMonth) { capCogsThisMonth += capAmount; capQtyThisMonth += item.filledDropped; }
        else { capCogsBefore += capAmount; capQtyBefore += item.filledDropped; }
      }
    }

    const computeBucket = (
      cogsBefore: number,
      cogsThisMonth: number,
      paidBefore: number,
      paidThisMonth: number,
      qtyBefore: number,
      qtyThisMonth: number,
      openingBalance: number,
    ): SupplierBillBucket => {
      // Signed throughout (never floored mid-calculation) so an overpayment
      // that clears everything owed before this month correctly rolls the
      // leftover forward as a credit against THIS month's bill, rather than
      // being discarded. Worked example (the one the owner gave): prev bill
      // 1000, this month's bill 200, paid 1100 this month →
      // openingSigned=1000, remainingPrevSigned=1000-1100=-100 →
      // prevMonthPending=0, leftoverCredit=100, currentMonthPendingSigned=
      // 200-100=100 → currentMonthPending=100. Matches exactly.
      //
      // `openingBalance` (the manually-seeded pre-tracking debt) is folded
      // into `cogsBefore` here, ahead of everything else, so it's the FIRST
      // thing any payment clears — same waterfall, nothing bucket-specific.
      const openingSigned = cogsBefore + openingBalance - paidBefore;
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
        prevMonthBottles: qtyBefore,
        currentMonthBottles: qtyThisMonth,
        openingBalance: round2(openingBalance),
      };
    };

    return {
      periodLabel,
      plant: computeBucket(
        bottleCogsBefore,
        bottleCogsThisMonth,
        bottlePaidBeforeAgg._sum.amount ?? 0,
        bottlePaidThisMonthAgg._sum.amount ?? 0,
        bottleQtyBefore,
        bottleQtyThisMonth,
        openingBalance?.plantAmount ?? 0,
      ),
      caps: computeBucket(
        capCogsBefore,
        capCogsThisMonth,
        capPaidBeforeAgg._sum.amount ?? 0,
        capPaidThisMonthAgg._sum.amount ?? 0,
        capQtyBefore,
        capQtyThisMonth,
        openingBalance?.capsAmount ?? 0,
      ),
    };
  }
}
