import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { queryKeys } from '../../../lib/query-keys';

export const usePlatformOverview = () =>
  useQuery({
    queryKey: queryKeys.dashboard.platform,
    queryFn: dashboardApi.getPlatformOverview,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
