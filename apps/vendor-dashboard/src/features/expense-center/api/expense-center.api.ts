import { apiClient } from '@water-supply-crm/data-access';

/**
 * Expense Center — unified read layer over every cost-bearing source in the
 * system (plain Expenses, Staff Ledger payroll rows, Crew Cash distributions).
 *
 * The types below are local mirrors of the backend contract, deliberately NOT
 * imported from `@water-supply-crm/types` — the Expense Center endpoints are a
 * read-only projection assembled by the API and have no Prisma model of their
 * own, so there is nothing shared to import.
 */

/** Top-level cost bucket a timeline row rolls up into. */
export type ExpenseCenterDomain =
  | 'VEHICLE'
  | 'EMPLOYEES'
  | 'OFFICE'
  | 'INVENTORY'
  | 'CAPITAL'
  | 'DISCREPANCY';

/**
 * `CREDIT` marks a payroll credit to an employee (bonus / incentive /
 * reimbursement / paid leave). It is still a real business cost — it is NOT
 * revenue and must never be rendered as a positive/green figure.
 */
export type ExpenseCenterCostSign = 'DEBIT' | 'CREDIT';

/** Which underlying table the row was projected from. */
export type ExpenseCenterSourceType = 'EXPENSE' | 'STAFF_LEDGER' | 'CREW_CASH';

export interface ExpenseCenterTopCategory {
  category: string;
  label: string;
  amount: number;
}

export interface ExpenseCenterDomainSlice {
  domain: ExpenseCenterDomain;
  amount: number;
  percent: number;
}

export interface ExpenseCenterSummary {
  totalSpend: number;
  cashAmount: number;
  cardAmount: number;
  cashPercent: number;
  cardPercent: number;
  topCategory: ExpenseCenterTopCategory | null;
  /** `null` when there is no comparable previous period to measure against. */
  momDeltaPercent: number | null;
  byDomain: ExpenseCenterDomainSlice[];
}

export interface ExpenseCenterRow {
  id: string;
  date: string;
  domain: ExpenseCenterDomain;
  category: string;
  categoryLabel: string;
  title: string;
  /** Always positive — direction lives in `costSign`, never in the number. */
  amount: number;
  costSign: ExpenseCenterCostSign;
  paidFromCash: boolean | null;
  recordedByName: string | null;
  sourceType: ExpenseCenterSourceType;
  /** Human-readable provenance chip, e.g. "via Daily Sheet #482", "via Payroll". */
  sourceBadge: string;
  vanPlateNumber: string | null;
  employeeName: string | null;
}

export interface ExpenseCenterSummaryQuery {
  from?: string;
  to?: string;
}

export interface ExpenseCenterTimelineQuery extends ExpenseCenterSummaryQuery {
  page?: number;
  limit?: number;
  domain?: ExpenseCenterDomain;
  category?: string;
  vanId?: string;
  employeeId?: string;
  paymentMethod?: string;
}

export interface ExpenseCenterTimelineMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExpenseCenterTimelineResponse {
  data: ExpenseCenterRow[];
  meta: ExpenseCenterTimelineMeta;
}

export const expenseCenterApi = {
  getSummary: (params?: ExpenseCenterSummaryQuery) =>
    apiClient.get<ExpenseCenterSummary>('/expense-center/summary', { params }),
  getTimeline: (params: ExpenseCenterTimelineQuery) =>
    apiClient.get<ExpenseCenterTimelineResponse>('/expense-center/timeline', { params }),
};
