'use client';

import { useQuery } from '@tanstack/react-query';
import { trackingApi } from '../api/tracking.api';
import { dailySheetsApi } from '../../daily-sheets/api/daily-sheets.api';

export const useDriverRouteHistory = (driverId: string, date: string) => {
  return useQuery({
    queryKey: ['tracking', 'history', driverId, date],
    queryFn: () => trackingApi.getRouteHistory(driverId, date).then((r) => r.data),
    enabled: !!driverId && !!date,
  });
};

export interface VanSheetLookup {
  id: string;
  driver: { id: string; name: string } | null;
  crew: { user: { id: string; name: string; role: string } }[];
}

/**
 * GPS breadcrumbs/stops are recorded per-driver (DriverLocationHistory etc.
 * have no vanId — see schema), not per-van. So "replay this van's day" means
 * resolving which driver actually ran that van's sheet on the given date
 * (the assignment can change day-to-day via swap-assignment) and replaying
 * their trail. This looks up that sheet to make the resolution.
 */
export const useVanDailySheet = (vanId: string, date: string) => {
  return useQuery({
    queryKey: ['tracking', 'van-sheet', vanId, date],
    queryFn: () =>
      dailySheetsApi
        .getAll({ vanId, date, limit: 1 })
        .then((r) => (r.data as { data?: VanSheetLookup[] }).data?.[0] ?? null),
    enabled: !!vanId && !!date,
  });
};
