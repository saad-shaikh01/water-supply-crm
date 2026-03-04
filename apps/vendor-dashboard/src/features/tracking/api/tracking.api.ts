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
  /** Freshness metadata from backend (TRK-BE-003) */
  freshness: 'LIVE' | 'STALE' | 'OFFLINE';
  /** Seconds since last update (TRK-BE-003) */
  lastSeenSeconds: number;
  /** Context from active sheet (TRK-BE-007) */
  vanId?: string;
  dailySheetId?: string;
  updatedAt: string;
}

export const trackingApi = {
  getActiveDrivers: () => 
    apiClient.get<DriverLocation[]>('/tracking/active'),
  
  getDriverLocation: (driverId: string) => 
    apiClient.get<{ location: DriverLocation | null }>(`/tracking/driver/${driverId}`),
};
