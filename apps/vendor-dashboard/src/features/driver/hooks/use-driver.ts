import { useQuery } from '@tanstack/react-query';
import { driverApi } from '../api/driver.api';
import { useAuthStore } from '../../../store/auth.store';

export const useDriverStats = (params?: {
  /** Explicit driver ID — used when an admin views another driver's history via URL param.
   *  Falls back to the logged-in user's own ID when omitted (driver viewing their own history). */
  driverId?: string;
  month?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  const user = useAuthStore((s) => s.user);
  const resolvedDriverId = params?.driverId ?? user?.id;
  const { driverId: _dropped, ...apiParams } = params ?? {};
  return useQuery({
    queryKey: ['driver', 'stats', resolvedDriverId, apiParams],
    queryFn: () => driverApi.getStats(resolvedDriverId!, apiParams).then((r) => r.data),
    enabled: !!resolvedDriverId,
    staleTime: 30_000,
  });
};
