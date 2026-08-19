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
  /** DB last-known report time, if the driver ever reported this trip; null = never reported at all */
  lastSeenAt: string | null;
}

export interface RouteHistoryPoint {
  latitude: number;
  longitude: number;
  speed: number | null;
  bearing: number | null;
  recordedAt: string;
}

export interface RouteHistoryStop {
  id: string | null;
  latitude: number;
  longitude: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  stopType: 'DELIVERY' | 'UNKNOWN' | string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedDeliveryItemId: string | null;
}

export interface RouteHistoryDelivery {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  latitude: number;
  longitude: number;
  deliveredAt: string;
  status: string;
}

export interface RouteHistorySummary {
  startedAt: string | null;
  endedAt: string | null;
  totalDistanceMeters: number;
  movingDurationSeconds: number;
  stopDurationSeconds: number;
  stopsCount: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  pointsCount: number;
  isFinal: boolean;
}

export interface RouteHistoryResponse {
  driver: { id: string; name: string };
  date: string;
  pointsAvailable: boolean;
  points: RouteHistoryPoint[];
  stops: RouteHistoryStop[];
  deliveries: RouteHistoryDelivery[];
  summary: RouteHistorySummary | null;
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

  /** Full-day route playback: polyline (if within retention), stops, delivery pins, and a summary. */
  getRouteHistory: (driverId: string, date: string) =>
    apiClient.get<RouteHistoryResponse>('/tracking/history/route', { params: { driverId, date } }),
};
