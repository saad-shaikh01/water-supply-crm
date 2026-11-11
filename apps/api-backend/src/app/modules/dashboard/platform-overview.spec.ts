import { CACHE_KEYS, CACHE_TTLS } from '@water-supply-crm/caching';
import { DashboardService } from './dashboard.service';

type Opts = {
  thisMonth?: number | null;
  lastMonth?: number | null;
  allTime?: number | null;
  top?: { vendorId: string; amount: number | null }[];
  vendors?: { id: string; name: string; slug: string }[];
  cached?: unknown;
};

function build(o: Opts = {}) {
  const sum = (v: number | null | undefined) => ({ _sum: { amount: v === undefined ? 0 : v } });
  const aggregate = jest
    .fn()
    .mockResolvedValueOnce(sum(o.allTime))
    .mockResolvedValueOnce(sum(o.thisMonth))
    .mockResolvedValueOnce(sum(o.lastMonth));
  const vendorCount = jest
    .fn()
    .mockResolvedValueOnce(7) // total
    .mockResolvedValueOnce(5) // active
    .mockResolvedValueOnce(2) // suspended
    .mockResolvedValueOnce(1); // new this month
  const prisma = {
    vendor: { count: vendorCount, findMany: jest.fn(async () => o.vendors ?? []) },
    customer: { count: jest.fn(async () => 40) },
    user: { count: jest.fn(async () => 9) },
    transaction: {
      aggregate,
      groupBy: jest.fn(async () => (o.top ?? []).map((t) => ({ vendorId: t.vendorId, _sum: { amount: t.amount } }))),
    },
    dailySheetItem: { count: jest.fn(async () => 123) },
  };
  const cache = { get: jest.fn(async () => o.cached), set: jest.fn(async () => undefined) };
  const service = new DashboardService(prisma as never, cache as never);
  return { service, prisma, cache };
}

describe('DashboardService.getPlatformOverview', () => {
  it('returns the documented shape', async () => {
    const { service } = build({
      allTime: 1000,
      thisMonth: 300,
      lastMonth: 200,
      top: [{ vendorId: 'v1', amount: 900 }],
      vendors: [{ id: 'v1', name: 'Acme', slug: 'acme' }],
    });
    await expect(service.getPlatformOverview()).resolves.toEqual({
      vendors: { total: 7, active: 5, suspended: 2, newThisMonth: 1 },
      customers: { total: 40 },
      drivers: { totalActive: 9 },
      revenue: { allTime: 1000, thisMonth: 300, lastMonth: 200, growthPercent: 50 },
      deliveries: { thisMonth: 123 },
      topVendors: [{ vendor: { id: 'v1', name: 'Acme', slug: 'acme' }, totalRevenue: 900 }],
    });
  });

  it.each([
    [150, 100, 50],
    [80, 100, -20],
    [100, 0, 0],
    [0, 0, 0],
  ])('growthPercent for %p vs %p is %p', async (thisMonth, lastMonth, expected) => {
    const { service } = build({ thisMonth, lastMonth });
    expect((await service.getPlatformOverview()).revenue.growthPercent).toBe(expected);
  });

  it('treats missing sums as 0', async () => {
    const { service } = build({ allTime: null, thisMonth: null, lastMonth: null, top: [{ vendorId: 'v1', amount: null }] });
    const r = await service.getPlatformOverview();
    expect(r.revenue).toEqual({ allTime: 0, thisMonth: 0, lastMonth: 0, growthPercent: 0 });
    expect(r.topVendors[0].totalRevenue).toBe(0);
  });

  it('falls back to { id } when the vendor row is missing', async () => {
    const { service } = build({ top: [{ vendorId: 'gone', amount: 5 }], vendors: [] });
    expect((await service.getPlatformOverview()).topVendors[0].vendor).toEqual({ id: 'gone' });
  });

  it('returns the cached object without touching prisma', async () => {
    const cached = { cached: true };
    const { service, prisma, cache } = build({ cached });
    await expect(service.getPlatformOverview()).resolves.toBe(cached);
    expect(cache.get).toHaveBeenCalledWith(CACHE_KEYS.PLATFORM_DASHBOARD_OVERVIEW);
    expect(prisma.vendor.count).not.toHaveBeenCalled();
    expect(prisma.transaction.aggregate).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('on a miss writes the result under the platform key with the dashboard TTL', async () => {
    const { service, cache } = build();
    const r = await service.getPlatformOverview();
    expect(cache.set).toHaveBeenCalledWith(CACHE_KEYS.PLATFORM_DASHBOARD_OVERVIEW, r, CACHE_TTLS.DASHBOARD);
  });
});
