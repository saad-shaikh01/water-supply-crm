import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { queryKeys } from '../../../lib/query-keys';

export const useOverviewStats = () => {
  return useQuery({
    queryKey: queryKeys.dashboard.overview,
    queryFn: () => dashboardApi.getOverview().then((r) => r.data),
  });
};

export const useRevenueStats = (dateFrom: string, dateTo: string, enabled = true) => {
  return useQuery({
    queryKey: ['dashboard', 'revenue', dateFrom, dateTo],
    queryFn: () => dashboardApi.getRevenue(dateFrom, dateTo).then((r) => r.data),
    enabled: enabled && !!dateFrom && !!dateTo,
  });
};

export const useTopCustomers = (limit = 5) => {
  return useQuery({
    queryKey: ['dashboard', 'top-customers', limit],
    queryFn: () => dashboardApi.getTopCustomers(limit).then((r) => r.data),
  });
};

export const useMonthlySummary = (months = 6) => {
  return useQuery({
    queryKey: ['dashboard', 'monthly-summary', months],
    queryFn: () => dashboardApi.getMonthlySummary(months).then((r) => r.data),
  });
};
