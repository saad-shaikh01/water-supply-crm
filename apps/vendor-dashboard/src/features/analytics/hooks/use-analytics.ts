import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics.api';

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
