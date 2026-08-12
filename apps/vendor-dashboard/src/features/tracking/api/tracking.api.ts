import { apiClient } from '@water-supply-crm/data-access';

export interface DriverLocation {
  driverId: string;
  driverName: string;
  vendorId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  bearing?: number;
  /** 'offline' is a server-sent sentinel — hook removes the driver from state on receipt */
  status: 'ONLINE' | 'DELIVERING' | 'AWAY' | 'offline';
  /** Freshness metadata from backend */
  freshness: 'LIVE' | 'STALE' | 'OFFLINE';
  /** Seconds since last update */
  lastSeenSeconds: number;
  /** Context from active sheet */
  vanId?: string;
  dailySheetId?: string;
  updatedAt: string;
}

export interface UpdateLocationPayload {
  latitude: number;
  longitude: number;
  speed?: number;
  bearing?: number;
  status?: 'ONLINE' | 'DELIVERING' | 'AWAY';
}

export interface MissingLocationDriver {
  driverId: string;
  driverName: string;
  vanPlate: string | null;
  dailySheetId: string;
  tripStartedAt: string;
}

export const trackingApi = {
  getActiveDrivers: () =>
    apiClient.get<DriverLocation[]>('/tracking/active'),

  /** Safety-net: drivers mid-trip with zero live GPS reports (permission denied, GPS off, etc). */
  getMissingLocationDrivers: () =>
    apiClient.get<MissingLocationDriver[]>('/tracking/missing'),

  getDriverLocation: (driverId: string) =>
    apiClient.get<{ location: DriverLocation | null }>(`/tracking/driver/${driverId}`),

  updateLocation: (payload: UpdateLocationPayload) =>
    apiClient.post<{ success: boolean; updatedAt: string }>('/tracking/location', payload),
};
