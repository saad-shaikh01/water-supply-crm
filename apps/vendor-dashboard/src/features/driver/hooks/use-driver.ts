import { useQuery } from '@tanstack/react-query';
import { driverApi } from '../api/driver.api';
import { useAuthStore } from '../../../store/auth.store';

export const useDriverStats = (params?: {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['driver', 'stats', user?.id, params],
    queryFn: () => driverApi.getStats(user!.id, params).then((r) => r.data),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
};
