import { apiClient } from '@water-supply-crm/data-access';

export interface DriverStats {
  totalSheets: number;
  totalItems: number;
  deliveredCount: number;
  successRate: number;
  totalBottlesDropped: number;
  totalEmptiesReceived: number;
  cashExpected: number;
  cashCollected: number;
  cashDiscrepancy: number;
  failureBreakdown: Record<string, number>;
  sheets: {
    id: string;
    date: string;
    van: string;
    route: string | null;
    totalItems: number;
    deliveredItems: number;
    cashCollected: number;
    cashExpected: number;
  }[];
}

export const driverApi = {
  getStats: (
    driverId: string,
    params?: { month?: string; dateFrom?: string; dateTo?: string },
  ) =>
    apiClient.get<DriverStats>(`/daily-sheets/driver/${driverId}/stats`, {
      params,
    }),
};
