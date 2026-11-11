/** Shape of `GET /dashboard/platform` (SUPER_ADMIN). */
export interface PlatformOverview {
  vendors: { total: number; active: number; suspended: number; newThisMonth: number };
  customers: { total: number };
  drivers: { totalActive: number };
  revenue: { allTime: number; thisMonth: number; lastMonth: number; growthPercent: number };
  deliveries: { thisMonth: number };
  topVendors: Array<{
    vendor: { id: string; name?: string; slug?: string };
    totalRevenue: number;
  }>;
}
