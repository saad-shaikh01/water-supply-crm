import { ExpenseCategory } from '@prisma/client';
import {
  buildDomainTree,
  buildSummary,
  domainForKey,
  isProfitLossSourceKey,
  monthRange,
  perBottle,
  shiftMonth,
  sumCategoryTotals,
  PROFIT_LOSS_DOMAINS,
  type CategoryTotal,
  type ProfitLossSourceKey,
} from './profit-loss.util';

describe('profit-loss.util', () => {
  it('maps EVERY ExpenseCategory into a rendered domain (nothing can be silently dropped)', () => {
    for (const category of Object.values(ExpenseCategory)) {
      expect(PROFIT_LOSS_DOMAINS).toContain(domainForKey(category));
      expect(isProfitLossSourceKey(category)).toBe(true);
    }
  });

  it('puts the three payroll streams under EMPLOYEES and rejects unknown keys', () => {
    expect(domainForKey('SALARY_SETTLEMENT')).toBe('EMPLOYEES');
    expect(domainForKey('SALARY_ADVANCE')).toBe('EMPLOYEES');
    expect(domainForKey('CREW_CASH')).toBe('EMPLOYEES');
    expect(isProfitLossSourceKey('NOPE')).toBe(false);
  });

  it('perBottle never divides by zero', () => {
    expect(perBottle(100, 0)).toBeNull();
    expect(perBottle(1387987, 9965)).toBeCloseTo(139.29, 2);
  });

  it('monthRange covers the PKT calendar month exactly', () => {
    const { start, end } = monthRange('2025-08');
    expect(start.toISOString()).toBe('2025-07-31T19:00:00.000Z');
    expect(end.toISOString()).toBe('2025-08-31T18:59:59.999Z');
  });

  it('shiftMonth crosses year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-03', -5)).toBe('2025-10');
  });

  it('domain tree subtotals add up to the grand total and keep every amount', () => {
    const totals = new Map<ProfitLossSourceKey, CategoryTotal>([
      [ExpenseCategory.FUEL_EXPENSE, { amount: 213483, count: 10 }],
      [ExpenseCategory.VEHICLE_MAINTENANCE, { amount: 127521, count: 3 }],
      [ExpenseCategory.POLICE, { amount: 0, count: 0 }],
      [ExpenseCategory.CHARITY, { amount: 20000, count: 1 }],
      ['SALARY_SETTLEMENT', { amount: 300000, count: 5 }],
      ['SALARY_ADVANCE', { amount: 50000, count: 2 }],
      ['CREW_CASH', { amount: 42983, count: 9 }],
    ]);
    const tree = buildDomainTree(totals, 9965);
    const grand = sumCategoryTotals(totals);
    expect(tree.reduce((s, d) => s + d.amount, 0)).toBeCloseTo(grand, 2);
    const vehicle = tree.find((d) => d.domain === 'VEHICLE');
    expect(vehicle?.amount).toBe(341004);
    expect(vehicle?.categories.map((c) => c.key)).toEqual([
      ExpenseCategory.FUEL_EXPENSE,
      ExpenseCategory.VEHICLE_MAINTENANCE,
    ]);
    expect(tree.find((d) => d.domain === 'EMPLOYEES')?.amount).toBe(392983);
    expect(tree.find((d) => d.domain === 'OFFICE')?.categories[0].key).toBe(ExpenseCategory.CHARITY);
    // Every domain is emitted even when empty.
    expect(tree.map((d) => d.domain)).toEqual([...PROFIT_LOSS_DOMAINS]);
  });

  it('reproduces the August 2025 sheet arithmetic', () => {
    const s = buildSummary({ bottlesSold: 9965, saleAmount: 1853490, amountReceived: 1758760 }, 1387987);
    expect(s.avgRatePerBottle).toBeCloseTo(186, 0);
    expect(s.avgExpensePerBottle).toBeCloseTo(139.29, 2);
    expect(s.avgProfitPerBottle).toBeCloseTo(46.71, 2);
    expect(s.saleProfit).toBe(465503);
    expect(s.recoveryProfit).toBe(370773);
  });

  it('a zero-bottle month yields null averages but still reports profit', () => {
    const s = buildSummary({ bottlesSold: 0, saleAmount: 0, amountReceived: 500 }, 1000);
    expect(s.avgExpensePerBottle).toBeNull();
    expect(s.avgProfitPerBottle).toBeNull();
    expect(s.recoveryProfit).toBe(-500);
  });
});
