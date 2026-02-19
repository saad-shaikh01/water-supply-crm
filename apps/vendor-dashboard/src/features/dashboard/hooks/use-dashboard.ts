import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { queryKeys } from '../../../lib/query-keys';

export const useOverviewStats = () => {
  return useQuery({
    queryKey: queryKeys.dashboard.overview,
    queryFn: () => dashboardApi.getOverview().then((r) => r.data),
  });
};

export const useRevenueStats = (dateFrom: string, dateTo: string) => {
  return useQuery({
    queryKey: ['dashboard', 'revenue', dateFrom, dateTo],
    queryFn: () => dashboardApi.getRevenue(dateFrom, dateTo).then((r) => r.data),
    enabled: !!dateFrom && !!dateTo,
  });
};

export const useTopCustomers = (limit = 5) => {
  return useQuery({
    queryKey: ['dashboard', 'top-customers', limit],
    queryFn: () => dashboardApi.getTopCustomers(limit).then((r) => r.data),
  });
};

export const useRoutePerformance = (date?: string) => {
  return useQuery({
    queryKey: ['dashboard', 'route-performance', date],
    queryFn: () => dashboardApi.getRoutePerformance(date).then((r) => r.data),
  });
};

export const useStaffPerformance = (from?: string, to?: string) => {
  return useQuery({
    queryKey: ['dashboard', 'staff-performance', from, to],
    queryFn: () => dashboardApi.getStaffPerformance(from, to).then((r) => r.data),
  });
};
