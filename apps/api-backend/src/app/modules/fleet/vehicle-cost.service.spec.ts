import { VehicleCostService, VEHICLE_OTHER_EXPENSE_CATEGORIES } from './vehicle-cost.service';
import { monthRange, pktMonthKey, lastMonthKeys } from './fleet-period.util';

const V = 'veh-1';
const d = (iso: string) => new Date(iso);

function makeService(data: { fuel?: any[]; service?: any[]; checks?: any[]; expenses?: any[] }) {
  const prisma: any = {
    vehicle: { findFirst: jest.fn().mockResolvedValue({ id: V }) },
    fuelLog: { findMany: jest.fn().mockResolvedValue(data.fuel ?? []) },
    vehicleServiceRecord: { findMany: jest.fn().mockResolvedValue(data.service ?? []) },
    vehicleDailyCheck: { findMany: jest.fn().mockResolvedValue(data.checks ?? []) },
    expense: { findMany: jest.fn().mockResolvedValue(data.expenses ?? []) },
  };
  return { svc: new VehicleCostService(prisma), prisma };
}

const check = (sheet: string, type: 'START' | 'END', odo: number, date = '2026-09-10T00:00:00Z') => ({
  vehicleId: V,
  dailySheetId: sheet,
  checkType: type,
  odometerReading: odo,
  dailySheet: { date: d(date) },
});

describe('fleet-period.util', () => {
  it('month range is Karachi midnight to Karachi midnight', () => {
    const r = monthRange('2026-09');
    expect(r.from.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-30T19:00:00.000Z');
  });

  it('a fill at 01:00 PKT on the 1st belongs to the new month', () => {
    expect(pktMonthKey(d('2026-09-30T20:00:00Z'))).toBe('2026-10');
    expect(pktMonthKey(d('2026-09-30T18:00:00Z'))).toBe('2026-09');
  });

  it('lastMonthKeys crosses the year boundary oldest-first', () => {
    expect(lastMonthKeys(3, '2026-01')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('VehicleCostService', () => {
  it('splits fuel / maintenance / other and never double-counts fuel or maintenance expenses', async () => {
    const { svc, prisma } = makeService({
      fuel: [{ vehicleId: V, date: d('2026-09-05T00:00:00Z'), litersFilled: 40, amountPaid: 12000, odometerAtFill: 1000, isFullTank: true }],
      service: [{ vehicleId: V, performedAtDate: d('2026-09-06T00:00:00Z'), cost: 5000 }],
      checks: [check('s1', 'START', 1000), check('s1', 'END', 1080)],
      expenses: [{ id: 'e1', amount: 700, date: d('2026-09-10T00:00:00Z'), dailySheetId: 's1' }],
    });

    const stats = (await svc.getStatsForMonth('vendor', [V], '2026-09')).get(V)!;

    expect(stats).toMatchObject({
      fuelCost: 12000,
      maintenanceCost: 5000,
      otherCost: 700,
      totalCost: 17700,
      kmDriven: 80,
      daysUsed: 1,
    });
    expect(stats.costPerKm).toBeCloseTo(221.25);
    // Only the whitelisted categories are queried, so FUEL_EXPENSE / VEHICLE_MAINTENANCE can't leak in.
    const where = prisma.expense.findMany.mock.calls[0][0].where;
    expect(where.category.in).toEqual(VEHICLE_OTHER_EXPENSE_CATEGORIES);
    expect(where.category.in).not.toContain('FUEL_EXPENSE');
    expect(where.category.in).not.toContain('VEHICLE_MAINTENANCE');
  });

  it('km is null-safe: a START without END contributes no distance', async () => {
    const { svc } = makeService({ checks: [check('s1', 'START', 1000)] });
    const stats = (await svc.getStatsForMonth('vendor', [V], '2026-09')).get(V)!;
    expect(stats.kmDriven).toBe(0);
    expect(stats.daysUsed).toBe(1);
    expect(stats.costPerKm).toBeNull();
  });

  it('ignores expenses on sheets this vehicle did not run', async () => {
    const { svc } = makeService({
      checks: [check('s1', 'START', 1000), check('s1', 'END', 1050)],
      expenses: [{ id: 'e9', amount: 999, date: d('2026-09-10T00:00:00Z'), dailySheetId: 'other-sheet' }],
    });
    const stats = (await svc.getStatsForMonth('vendor', [V], '2026-09')).get(V)!;
    expect(stats.otherCost).toBe(0);
  });

  it('monthly report buckets by Karachi month and returns every requested month', async () => {
    const { svc } = makeService({
      fuel: [
        { vehicleId: V, date: d('2026-08-10T00:00:00Z'), litersFilled: 10, amountPaid: 3000, odometerAtFill: 500, isFullTank: true },
        { vehicleId: V, date: d('2026-09-10T00:00:00Z'), litersFilled: 20, amountPaid: 6000, odometerAtFill: 900, isFullTank: true },
      ],
    });
    const rows = await svc.getMonthlyReport('vendor', V, 3, '2026-09');
    expect(rows.map((r) => r.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(rows.map((r) => r.fuelCost)).toEqual([0, 3000, 6000]);
  });
});
