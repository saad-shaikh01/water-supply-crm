import { ExpenseCategory } from '@prisma/client';
import {
  EXPENSE_CATEGORY_DOMAINS,
  labelForExpenseCategory,
  type ExpenseCenterDomain,
} from '../expense-center/expense-center-domain.util';
import { vendorDayEnd, vendorDayStart } from '../../common/helpers/date.util';

/**
 * Profit & Loss (Analytics tab) — pure helpers.
 *
 * Expense domains deliberately REUSE the Expense Center's domain mapping
 * (EXPENSE_CATEGORY_DOMAINS is a `Record<ExpenseCategory, …>`, so a new enum
 * value fails to compile until it is mapped — nothing can silently go missing).
 * Only three non-`Expense`-table cost streams get their own keys here:
 * payroll settlements, payroll advances, and crew cash.
 */

export type ProfitLossSourceKey = ExpenseCategory | 'SALARY_SETTLEMENT' | 'SALARY_ADVANCE' | 'CREW_CASH';

/** CAPITAL is omitted — it has no live source in the Expense Center either. */
export const PROFIT_LOSS_DOMAINS: readonly ExpenseCenterDomain[] = [
  'VEHICLE',
  'EMPLOYEES',
  'OFFICE',
  'INVENTORY',
  'DISCREPANCY',
];

export const PROFIT_LOSS_DOMAIN_LABELS: Record<ExpenseCenterDomain, string> = {
  VEHICLE: 'Vehicle / Fleet',
  EMPLOYEES: 'Staff & Payroll',
  OFFICE: 'Office & Admin',
  INVENTORY: 'Plant, Stock & Inventory',
  CAPITAL: 'Capital',
  DISCREPANCY: 'Discrepancy Write-offs',
};

const PAYROLL_KEY_META: Record<'SALARY_SETTLEMENT' | 'SALARY_ADVANCE' | 'CREW_CASH', string> = {
  SALARY_SETTLEMENT: 'Salaries Paid (Settlements)',
  SALARY_ADVANCE: 'Salary Advances',
  CREW_CASH: 'Crew Cash',
};

export function isExpenseCategoryKey(key: string): key is ExpenseCategory {
  return Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORY_DOMAINS, key);
}

export function isProfitLossSourceKey(key: string): key is ProfitLossSourceKey {
  return isExpenseCategoryKey(key) || key in PAYROLL_KEY_META;
}

export function domainForKey(key: ProfitLossSourceKey): ExpenseCenterDomain {
  if (isExpenseCategoryKey(key)) return EXPENSE_CATEGORY_DOMAINS[key] ?? 'OFFICE';
  return 'EMPLOYEES';
}

export function labelForKey(key: ProfitLossSourceKey): string {
  if (isExpenseCategoryKey(key)) return labelForExpenseCategory(key);
  return PAYROLL_KEY_META[key];
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Amount per bottle, or null when no bottle was sold (never divide by zero). */
export function perBottle(amount: number, bottles: number): number | null {
  return bottles > 0 ? round2(amount / bottles) : null;
}

// ── Month handling (vendor / PKT calendar) ────────────────────────────────────

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

export function monthRange(month: string): { start: Date; end: Date } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    start: vendorDayStart(`${month}-01`),
    end: vendorDayEnd(`${month}-${String(lastDay).padStart(2, '0')}`),
  };
}

export function shiftMonth(month: string, delta: number): string {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// ── Domain tree ───────────────────────────────────────────────────────────────

export interface CategoryTotal {
  amount: number;
  count: number;
}

export interface ProfitLossCategoryRow {
  key: ProfitLossSourceKey;
  label: string;
  amount: number;
  count: number;
  perBottle: number | null;
  percent: number;
}

export interface ProfitLossDomainRow {
  domain: ExpenseCenterDomain;
  label: string;
  amount: number;
  count: number;
  perBottle: number | null;
  percent: number;
  categories: ProfitLossCategoryRow[];
}

export function sumCategoryTotals(totals: Map<ProfitLossSourceKey, CategoryTotal>): number {
  let sum = 0;
  for (const v of totals.values()) sum += v.amount;
  return sum;
}

/**
 * Groups flat per-category totals into the domain → category tree. Zero-amount
 * categories are dropped, empty domains are still emitted (stable layout).
 * Categories are sorted biggest-first inside a domain.
 */
export function buildDomainTree(
  totals: Map<ProfitLossSourceKey, CategoryTotal>,
  bottlesSold: number,
): ProfitLossDomainRow[] {
  const grand = sumCategoryTotals(totals);
  const pct = (amount: number) => (grand > 0 ? round1((amount / grand) * 100) : 0);

  const byDomain = new Map<ExpenseCenterDomain, ProfitLossCategoryRow[]>();
  for (const domain of PROFIT_LOSS_DOMAINS) byDomain.set(domain, []);

  for (const [key, total] of totals) {
    if (!(total.amount > 0)) continue;
    const domain = domainForKey(key);
    const bucket = byDomain.get(domain) ?? [];
    bucket.push({
      key,
      label: labelForKey(key),
      amount: round2(total.amount),
      count: total.count,
      perBottle: perBottle(total.amount, bottlesSold),
      percent: pct(total.amount),
    });
    byDomain.set(domain, bucket);
  }

  const rows: ProfitLossDomainRow[] = [];
  for (const [domain, categories] of byDomain) {
    categories.sort((a, b) => b.amount - a.amount);
    const amount = categories.reduce((s, c) => s + c.amount, 0);
    rows.push({
      domain,
      label: PROFIT_LOSS_DOMAIN_LABELS[domain],
      amount: round2(amount),
      count: categories.reduce((s, c) => s + c.count, 0),
      perBottle: perBottle(amount, bottlesSold),
      percent: pct(amount),
      categories,
    });
  }
  return rows;
}

export interface SalesFigures {
  /** Net bottles: delivered minus filled bottles taken back (matches the net Sale amount). */
  bottlesSold: number;
  saleAmount: number;
  amountReceived: number;
  /** Gross filled bottles dropped — the figure the Deliveries tab / dashboard call "delivered". */
  bottlesDelivered?: number;
  /** Filled bottles taken back from customers (credited at the same rate, so they reduce the sale). */
  filledReturned?: number;
  /** Payments collected against a delivery (cash handed to the driver on the sheet). */
  receivedOnSheets?: number;
  /** Payments recorded outside a delivery (dashboard Record Payment, portal, walk-in top-ups). */
  receivedRecorded?: number;
}

export function buildSummary(sales: SalesFigures, totalExpenses: number) {
  const { bottlesSold, saleAmount, amountReceived } = sales;
  return {
    bottlesDelivered: sales.bottlesDelivered ?? bottlesSold,
    filledReturned: sales.filledReturned ?? 0,
    receivedOnSheets: round2(sales.receivedOnSheets ?? amountReceived),
    receivedRecorded: round2(sales.receivedRecorded ?? 0),
    bottlesSold,
    saleAmount: round2(saleAmount),
    amountReceived: round2(amountReceived),
    totalExpenses: round2(totalExpenses),
    avgRatePerBottle: perBottle(saleAmount, bottlesSold),
    avgExpensePerBottle: perBottle(totalExpenses, bottlesSold),
    avgProfitPerBottle: bottlesSold > 0 ? round2((saleAmount - totalExpenses) / bottlesSold) : null,
    saleProfit: round2(saleAmount - totalExpenses),
    recoveryProfit: round2(amountReceived - totalExpenses),
  };
}

// ── "Actual cost" (accrual) adjustments ───────────────────────────────────────
//
// The P&L is cash-basis: a cost lands in the month it was PAID. Plant bill,
// caps bill and salaries are routinely paid a month late, so the owner can opt
// into an "actual cost" view per adjustment: take out what was paid this month
// for EARLIER months, and add this month's own cost that is still unpaid.

export const ADJUSTMENT_KEYS = [
  'PLANT_PRIOR_PAID',
  'PLANT_PENDING',
  'CAPS_PRIOR_PAID',
  'CAPS_PENDING',
  'SALARY_PRIOR_PAID',
  'SALARY_PENDING',
] as const;

export type AdjustmentKey = (typeof ADJUSTMENT_KEYS)[number];

export function isAdjustmentKey(key: string): key is AdjustmentKey {
  return (ADJUSTMENT_KEYS as readonly string[]).includes(key);
}

/** Which cost categories an adjustment moves money in (removals spill across them in order). */
export const ADJUSTMENT_CATEGORY_KEYS: Record<'PLANT' | 'CAPS' | 'SALARY', ProfitLossSourceKey[]> = {
  PLANT: [ExpenseCategory.BOTTLE_REFILL_PAYMENT, ExpenseCategory.BOTTLE_PURCHASED],
  CAPS: [ExpenseCategory.CAPS_PURCHASED],
  SALARY: ['SALARY_SETTLEMENT'],
};

export interface AdjustmentItem {
  key: AdjustmentKey;
  group: 'PLANT' | 'CAPS' | 'SALARY';
  /** REMOVE_PRIOR_PAID subtracts, ADD_PENDING adds. */
  kind: 'REMOVE_PRIOR_PAID' | 'ADD_PENDING';
  label: string;
  hint: string;
  /** Always >= 0 — the size of the movement. */
  amount: number;
}

export function adjustmentDelta(item: Pick<AdjustmentItem, 'kind' | 'amount'>): number {
  return item.kind === 'ADD_PENDING' ? item.amount : -item.amount;
}

/**
 * Returns a copy of the cash-basis category totals with the given adjustments
 * applied. Additions go to the group's first category; removals are taken from
 * the group's categories in order and never push a category below zero.
 */
export function applyAdjustments(
  totals: Map<ProfitLossSourceKey, CategoryTotal>,
  items: AdjustmentItem[],
): Map<ProfitLossSourceKey, CategoryTotal> {
  const out = new Map<ProfitLossSourceKey, CategoryTotal>();
  for (const [k, v] of totals) out.set(k, { ...v });

  for (const item of items) {
    if (!(item.amount > 0)) continue;
    const keys = ADJUSTMENT_CATEGORY_KEYS[item.group];
    if (item.kind === 'ADD_PENDING') {
      const cur = out.get(keys[0]) ?? { amount: 0, count: 0 };
      out.set(keys[0], { amount: cur.amount + item.amount, count: cur.count });
      continue;
    }
    let remaining = item.amount;
    for (const k of keys) {
      if (remaining <= 0) break;
      const cur = out.get(k);
      if (!cur || cur.amount <= 0) continue;
      const take = Math.min(cur.amount, remaining);
      out.set(k, { amount: cur.amount - take, count: cur.count });
      remaining -= take;
    }
  }
  return out;
}
