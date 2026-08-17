'use client';

import { useQuery } from '@tanstack/react-query';
import { trackingApi } from '../api/tracking.api';

export const useDriverRouteHistory = (driverId: string, date: string) => {
  return useQuery({
    queryKey: ['tracking', 'history', driverId, date],
    queryFn: () => trackingApi.getRouteHistory(driverId, date).then((r) => r.data),
    enabled: !!driverId && !!date,
  });
};
