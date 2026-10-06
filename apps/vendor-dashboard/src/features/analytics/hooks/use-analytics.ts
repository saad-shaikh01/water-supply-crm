import { useQuery } from '@tanstack/react-query';
import { analyticsApi, profitLossApi } from '../api/analytics.api';

export const useFinancialAnalytics = (from: string, to: string, vanId?: string) =>
  useQuery({
    queryKey: ['analytics', 'financial', from, to, vanId ?? ''],
    queryFn: () => analyticsApi.getFinancial(from, to, vanId).then((r) => r.data),
  });

export const useDeliveryAnalytics = (from: string, to: string, vanId?: string) =>
  useQuery({
    queryKey: ['analytics', 'deliveries', from, to, vanId ?? ''],
    queryFn: () => analyticsApi.getDeliveries(from, to, vanId).then((r) => r.data),
  });

export const useCustomerAnalytics = (from: string, to: string, vanId?: string) =>
  useQuery({
    queryKey: ['analytics', 'customers', from, to, vanId ?? ''],
    queryFn: () => analyticsApi.getCustomers(from, to, vanId).then((r) => r.data),
  });

export const useStaffAnalytics = (from: string, to: string, vanId?: string) =>
  useQuery({
    queryKey: ['analytics', 'staff', from, to, vanId ?? ''],
    queryFn: () => analyticsApi.getStaff(from, to, vanId).then((r) => r.data),
  });

export const useOperationsAnalytics = (from: string, to: string, vanId?: string) =>
  useQuery({
    queryKey: ['analytics', 'operations', from, to, vanId ?? ''],
    queryFn: () => analyticsApi.getOperations(from, to, vanId).then((r) => r.data),
  });

export interface ProfitLossCategory {
  key: string;
  label: string;
  /** Actual-cost view only: how much of `amount` comes from applied adjustments (+ added, - removed). */
  adjustment?: number;
  /** Actual-cost view: this amount is a what-if (rate x bottles), not recorded cost. */
  simulated?: boolean;
  amount: number;
  count: number;
  perBottle: number | null;
  percent: number;
}

export interface ProfitLossDomain {
  domain: string;
  label: string;
  amount: number;
  count: number;
  perBottle: number | null;
  percent: number;
  categories: ProfitLossCategory[];
}

export interface ProfitLossSummary {
  bottlesDelivered: number;
  filledReturned: number;
  receivedOnSheets: number;
  receivedRecorded: number;
  bottlesSold: number;
  saleAmount: number;
  amountReceived: number;
  totalExpenses: number;
  avgRatePerBottle: number | null;
  avgExpensePerBottle: number | null;
  avgProfitPerBottle: number | null;
  saleProfit: number;
  recoveryProfit: number;
}

export const PROFIT_LOSS_ADJUSTMENT_KEYS = [
  'PLANT_PRIOR_PAID',
  'PLANT_PENDING',
  'CAPS_PRIOR_PAID',
  'CAPS_PENDING',
  'SALARY_PRIOR_PAID',
  'SALARY_PENDING',
] as const;
export type ProfitLossAdjustmentKey = (typeof PROFIT_LOSS_ADJUSTMENT_KEYS)[number];

/** One "actual cost" adjustment candidate — a cost paid in a different month than it belongs to. */
export interface ProfitLossAdjustment {
  key: ProfitLossAdjustmentKey;
  group: 'PLANT' | 'CAPS' | 'SALARY';
  kind: 'REMOVE_PRIOR_PAID' | 'ADD_PENDING';
  label: string;
  hint: string;
  /** Size of the movement, always >= 0. */
  amount: number;
  /** Signed effect on Total Expenses when applied. */
  delta: number;
  applied: boolean;
  /** A what-if rate currently replaces this group's cost, so this row is set aside. */
  superseded?: boolean;
  /** Per-month lines behind the amount. */
  details?: Array<{ label: string; amount: number }>;
  /** Context line, e.g. overall balance owed vs. this month's share. */
  note?: string;
}

/** Planning inputs sent with the request (never stored on the server). */
export interface ProfitLossWhatIfParams {
  plantRate?: number;
  capsRate?: number;
  basis?: 'DELIVERED' | 'NET';
}

export interface ProfitLossData {
  month: string;
  /** CASH = costs in the month they were paid; ACTUAL = with the selected adjustments applied. */
  basis: 'CASH' | 'ACTUAL';
  adjustments: ProfitLossAdjustment[];
  /** Actual-cost view only: the bottle count and result of any active what-if rate. */
  whatIf?: {
    basis: 'DELIVERED' | 'NET';
    bottles: number;
    plant: { rate: number; amount: number } | null;
    caps: { rate: number; amount: number } | null;
  };
  /** Applied adjustments' net effect on Total Expenses (0 on CASH). */
  adjustmentTotal: number;
  summary: ProfitLossSummary;
  receivedBreakdown: {
    onSheets: { amount: number; count: number };
    recorded: Array<{ mode: string; amount: number; count: number }>;
  };
  handoverReconciliation: {
    sheetCount: number;
    deliveryCashRecorded: number;
    vanCashExpenses: number;
    crewCashPaid: number;
    expectedHandIn: number;
    actualHandedIn: number;
    difference: number;
  };
  domains: ProfitLossDomain[];
  reconciliation: { expenseTableTotal: number; groupedExpenseTableTotal: number; difference: number; ok: boolean };
  trend: Array<ProfitLossSummary & { month: string; byDomain: Record<string, number> }>;
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

export interface ProfitLossDetails {
  month: string;
  category: string;
  categoryLabel: string;
  domain: string;
  total: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
  rows: ProfitLossDetailRow[];
}

export const useProfitLoss = (
  month: string,
  basis: 'CASH' | 'ACTUAL' = 'CASH',
  adjust: readonly string[] = [],
  enabled = true,
  whatIf?: ProfitLossWhatIfParams,
) =>
  useQuery<ProfitLossData>({
    queryKey: ['analytics', 'profit-loss', month, basis, adjust.join(','), whatIf?.plantRate ?? 0, whatIf?.capsRate ?? 0, whatIf?.basis ?? ''],
    queryFn: () => profitLossApi.get(month, adjust.join(','), basis, whatIf).then((r) => r.data),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useProfitLossDetails = (month: string, category: string | null, page: number) =>
  useQuery<ProfitLossDetails>({
    queryKey: ['analytics', 'profit-loss', 'details', month, category, page],
    queryFn: () => profitLossApi.getDetails(month, category as string, page).then((r) => r.data),
    enabled: !!category,
  });

export interface ProfitLossPaymentRow {
  id: string;
  date: string;
  amount: number;
  customerName: string | null;
  customerCode: string | null;
  mode: string;
  description: string | null;
  dailySheetId: string | null;
}

export interface ProfitLossPayments {
  month: string;
  kind: string;
  total: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
  rows: ProfitLossPaymentRow[];
}

export const useProfitLossPayments = (month: string, kind: string | null, page: number) =>
  useQuery<ProfitLossPayments>({
    queryKey: ['analytics', 'profit-loss', 'payments', month, kind, page],
    queryFn: () => profitLossApi.getPayments(month, kind as string, page).then((r) => r.data),
    enabled: !!kind,
  });
