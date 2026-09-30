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

export interface ProfitLossData {
  month: string;
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

export const useProfitLoss = (month: string) =>
  useQuery<ProfitLossData>({
    queryKey: ['analytics', 'profit-loss', month],
    queryFn: () => profitLossApi.get(month).then((r) => r.data),
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
