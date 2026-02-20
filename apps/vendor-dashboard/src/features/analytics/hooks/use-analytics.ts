import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics.api';

export const useFinancialAnalytics = (from: string, to: string) =>
  useQuery({
    queryKey: ['analytics', 'financial', from, to],
    queryFn: () => analyticsApi.getFinancial(from, to).then((r) => r.data),
  });

export const useDeliveryAnalytics = (from: string, to: string) =>
  useQuery({
    queryKey: ['analytics', 'deliveries', from, to],
    queryFn: () => analyticsApi.getDeliveries(from, to).then((r) => r.data),
  });

export const useCustomerAnalytics = (from: string, to: string) =>
  useQuery({
    queryKey: ['analytics', 'customers', from, to],
    queryFn: () => analyticsApi.getCustomers(from, to).then((r) => r.data),
  });

export const useStaffAnalytics = (from: string, to: string) =>
  useQuery({
    queryKey: ['analytics', 'staff', from, to],
    queryFn: () => analyticsApi.getStaff(from, to).then((r) => r.data),
  });
