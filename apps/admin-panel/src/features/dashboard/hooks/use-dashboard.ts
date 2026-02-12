import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { queryKeys } from '../../../lib/query-keys';

export const useOverviewStats = () => {
  return useQuery({
    queryKey: queryKeys.dashboard.overview,
    queryFn: () => dashboardApi.getOverview().then((r) => r.data),
  });
};
