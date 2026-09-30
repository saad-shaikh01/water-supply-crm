import type { ExpenseCenterDomain } from './expense-center-domain.util';
import { EXPENSE_CENTER_DOMAINS } from './expense-center-domain.util';

/**
 * Expense Center — month-wise Domain → Category → Subcategory roll-up.
 *
 * Pure aggregation, free of Prisma so it is unit-testable from plain objects
 * (same convention as expense-center-domain.util.ts). The service turns every
 * cost-bearing row from the four sources into a `CategorySummaryEntry` and this
 * folds them into the tree the frontend renders.
 *
 * Subcategories exist only where the data genuinely has a second level:
 *   - VEHICLE_MAINTENANCE -> the linked VehicleServiceRecord's service type
 *     (Engine Oil, Brake Pads ...); maintenance with no service record rolls
 *     into an explicit "Unspecified" bucket so the subcategories still sum to
 *     the category total.
 *   - CREW_CASH -> the CrewCashCategory (Meal / Tea / ...).
 * Every other category is a leaf (empty `subcategories`).
 */

export interface CategorySummaryEntry {
  domain: ExpenseCenterDomain;
  category: string;
  categoryLabel: string;
  subKey?: string | null;
  subLabel?: string | null;
  amount: number;
  date: Date;
}

export interface CategorySummaryNode {
  key: string;
  label: string;
  total: number;
  /** `YYYY-MM` -> amount. Only months with spend are present. */
  byMonth: Record<string, number>;
}

export interface CategorySummaryCategory extends CategorySummaryNode {
  subcategories: CategorySummaryNode[];
}

export interface CategorySummaryDomain extends CategorySummaryNode {
  domain: ExpenseCenterDomain;
  categories: CategorySummaryCategory[];
}

export interface CategorySummaryResult {
  /** Every calendar month in the range, oldest first, including empty ones. */
  months: string[];
  grandTotal: number;
  byMonth: Record<string, number>;
  domains: CategorySummaryDomain[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function monthKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

/** Every `YYYY-MM` from start's month to end's month, inclusive. */
export function monthsBetween(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

interface MutableNode {
  key: string;
  label: string;
  total: number;
  byMonth: Map<string, number>;
  children: Map<string, MutableNode>;
}

function newNode(key: string, label: string): MutableNode {
  return { key, label, total: 0, byMonth: new Map(), children: new Map() };
}

function add(node: MutableNode, month: string, amount: number): void {
  node.total += amount;
  node.byMonth.set(month, (node.byMonth.get(month) ?? 0) + amount);
}

function child(parent: MutableNode, key: string, label: string): MutableNode {
  let found = parent.children.get(key);
  if (!found) {
    found = newNode(key, label);
    parent.children.set(key, found);
  }
  return found;
}

function freeze(node: MutableNode): CategorySummaryNode {
  const byMonth: Record<string, number> = {};
  for (const [month, amount] of node.byMonth) byMonth[month] = round2(amount);
  return { key: node.key, label: node.label, total: round2(node.total), byMonth };
}

const byTotalDesc = (a: CategorySummaryNode, b: CategorySummaryNode): number => b.total - a.total;

export function buildCategorySummary(
  entries: CategorySummaryEntry[],
  start: Date,
  end: Date,
): CategorySummaryResult {
  const root = newNode('ALL', 'All');
  const domainNodes = new Map<ExpenseCenterDomain, MutableNode>();

  for (const entry of entries) {
    if (!(entry.amount > 0)) continue;
    const month = monthKey(entry.date);

    add(root, month, entry.amount);

    let domainNode = domainNodes.get(entry.domain);
    if (!domainNode) {
      domainNode = newNode(entry.domain, entry.domain);
      domainNodes.set(entry.domain, domainNode);
    }
    add(domainNode, month, entry.amount);

    const categoryNode = child(domainNode, entry.category, entry.categoryLabel);
    add(categoryNode, month, entry.amount);

    if (entry.subKey) {
      add(child(categoryNode, entry.subKey, entry.subLabel ?? entry.subKey), month, entry.amount);
    }
  }

  const domains: CategorySummaryDomain[] = [];
  for (const domain of EXPENSE_CENTER_DOMAINS) {
    const domainNode = domainNodes.get(domain);
    if (!domainNode) continue;

    const categories: CategorySummaryCategory[] = [...domainNode.children.values()]
      .map((categoryNode) => ({
        ...freeze(categoryNode),
        subcategories: [...categoryNode.children.values()].map(freeze).sort(byTotalDesc),
      }))
      .sort(byTotalDesc);

    domains.push({ ...freeze(domainNode), domain, categories });
  }
  domains.sort(byTotalDesc);

  const frozenRoot = freeze(root);
  return {
    months: monthsBetween(start, end),
    grandTotal: frozenRoot.total,
    byMonth: frozenRoot.byMonth,
    domains,
  };
}
