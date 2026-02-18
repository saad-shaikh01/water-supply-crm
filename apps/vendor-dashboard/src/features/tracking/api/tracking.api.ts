import { apiClient } from '@water-supply-crm/data-access';

export interface DriverLocation {
  driverId: string;
  driverName: string;
  vendorId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  bearing?: number;
  status: 'ONLINE' | 'DELIVERING' | 'AWAY';
  updatedAt: string;
}

export const trackingApi = {
  getActiveDrivers: () => 
    apiClient.get<DriverLocation[]>('/tracking/active'),
  
  getDriverLocation: (driverId: string) => 
    apiClient.get<{ location: DriverLocation | null }>(`/tracking/driver/${driverId}`),
};
