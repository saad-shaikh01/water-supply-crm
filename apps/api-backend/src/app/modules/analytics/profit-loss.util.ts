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
  bottlesSold: number;
  saleAmount: number;
  amountReceived: number;
}

export function buildSummary(sales: SalesFigures, totalExpenses: number) {
  const { bottlesSold, saleAmount, amountReceived } = sales;
  return {
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
