import { buildCategorySummary, monthsBetween, type CategorySummaryEntry } from './expense-center-category-summary.util';

const d = (y: number, m: number, day = 10) => new Date(y, m - 1, day, 12);

describe('monthsBetween', () => {
  it('lists every month inclusive, across a year boundary', () => {
    expect(monthsBetween(d(2026, 11), d(2027, 1))).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('buildCategorySummary', () => {
  const entries: CategorySummaryEntry[] = [
    { domain: 'VEHICLE', category: 'FUEL_EXPENSE', categoryLabel: 'Fuel', amount: 1000, date: d(2026, 9) },
    { domain: 'VEHICLE', category: 'FUEL_EXPENSE', categoryLabel: 'Fuel', amount: 500, date: d(2026, 10) },
    {
      domain: 'VEHICLE', category: 'VEHICLE_MAINTENANCE', categoryLabel: 'Vehicle Maintenance',
      subKey: 'ENGINE_OIL', subLabel: 'Engine Oil', amount: 300, date: d(2026, 9),
    },
    {
      domain: 'VEHICLE', category: 'VEHICLE_MAINTENANCE', categoryLabel: 'Vehicle Maintenance',
      subKey: 'UNSPECIFIED', subLabel: 'Unspecified', amount: 200, date: d(2026, 10),
    },
    { domain: 'OFFICE', category: 'RENT', categoryLabel: 'Rent', amount: 4000, date: d(2026, 9) },
    { domain: 'OFFICE', category: 'OTHER', categoryLabel: 'Miscellaneous', amount: 0, date: d(2026, 9) },
  ];

  const result = buildCategorySummary(entries, d(2026, 9, 1), d(2026, 10, 31));

  it('totals per domain, largest first, skipping zero rows', () => {
    expect(result.grandTotal).toBe(6000);
    expect(result.domains.map((x) => [x.domain, x.total])).toEqual([
      ['OFFICE', 4000],
      ['VEHICLE', 2000],
    ]);
    expect(result.domains[0].categories.map((c) => c.key)).toEqual(['RENT']);
  });

  it('splits maintenance into subcategories that sum to the category total', () => {
    const vehicle = result.domains.find((x) => x.domain === 'VEHICLE')!;
    const maintenance = vehicle.categories.find((c) => c.key === 'VEHICLE_MAINTENANCE')!;
    expect(maintenance.total).toBe(500);
    expect(maintenance.subcategories.reduce((s, x) => s + x.total, 0)).toBe(500);
    expect(maintenance.subcategories[0]).toMatchObject({ label: 'Engine Oil', total: 300 });
    const fuel = vehicle.categories.find((c) => c.key === 'FUEL_EXPENSE')!;
    expect(fuel.subcategories).toEqual([]);
  });

  it('buckets by month and emits every month in range', () => {
    expect(result.months).toEqual(['2026-09', '2026-10']);
    expect(result.byMonth).toEqual({ '2026-09': 5300, '2026-10': 700 });
  });
});
