import { BadRequestException } from '@nestjs/common';
import { ExpenseCategory } from '@prisma/client';
import { ProfitLossService } from './profit-loss.service';

const agg = (sum: Record<string, number | null>, count = 0) => Promise.resolve({ _sum: sum, _count: { _all: count } });

function makePrisma() {
  return {
    transaction: {
      aggregate: jest.fn().mockImplementation((args: any) =>
        args.where.type === 'DELIVERY'
          ? agg({ amount: 1853490, filledDropped: 10000, filledReceived: 35 })
          : agg({ amount: -1758760 }),
      ),
    },
    expense: {
      groupBy: jest.fn().mockResolvedValue([
        { category: ExpenseCategory.FUEL_EXPENSE, _sum: { amount: 213483 }, _count: { _all: 12 } },
        { category: ExpenseCategory.BOTTLE_REFILL_PAYMENT, _sum: { amount: 318880 }, _count: { _all: 2 } },
      ]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 532363 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    settlement: { aggregate: jest.fn().mockImplementation(() => agg({ amount: 300000 }, 4)), findMany: jest.fn() },
    staffLedgerEntry: {
      aggregate: jest.fn().mockImplementation(() => agg({ amount: -50000 }, 2)),
      findMany: jest.fn(),
    },
    crewCashDistribution: {
      aggregate: jest.fn().mockImplementation(() => agg({ amount: 30000 }, 6)),
      findMany: jest.fn(),
    },
    standaloneCrewCashExpense: {
      aggregate: jest.fn().mockImplementation(() => agg({ amount: 12983 }, 3)),
      findMany: jest.fn(),
    },
  };
}

function makeService(prisma: any) {
  const cache = {
    vendorKey: (_v: string, k: string) => k,
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new ProfitLossService(prisma, cache as any), cache };
}

describe('ProfitLossService', () => {
  it('combines Expense table + settlements + advances + both crew-cash tables with no double count', async () => {
    const { service } = makeService(makePrisma());
    const r = await service.getProfitLoss('v1', '2025-08');

    // 532,363 (Expense) + 300,000 + 50,000 + 30,000 + 12,983
    expect(r.summary.totalExpenses).toBe(925346);
    expect(r.summary.bottlesSold).toBe(9965);
    expect(r.summary.amountReceived).toBe(1758760);
    expect(r.summary.saleProfit).toBe(1853490 - 925346);
    expect(r.summary.recoveryProfit).toBe(1758760 - 925346);

    const employees = r.domains.find((d: any) => d.domain === 'EMPLOYEES');
    expect(employees.amount).toBe(392983);
    expect(employees.categories.map((c: any) => c.key).sort()).toEqual([
      'CREW_CASH',
      'SALARY_ADVANCE',
      'SALARY_SETTLEMENT',
    ]);
    expect(r.domains.reduce((s: number, d: any) => s + d.amount, 0)).toBe(925346);
    expect(r.reconciliation.ok).toBe(true);
    expect(r.trend).toHaveLength(6);
    expect(r.trend[5].month).toBe('2025-08');
  });

  it('flags a reconciliation gap when the raw Expense total disagrees with the grouped rows', async () => {
    const prisma = makePrisma();
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 600000 } });
    const { service } = makeService(prisma);
    const r = await service.getProfitLoss('v1', '2025-08');
    expect(r.reconciliation.ok).toBe(false);
    expect(r.reconciliation.difference).toBe(600000 - 532363);
  });

  it('scopes every query by vendorId', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await service.getProfitLoss('vendor-x', '2025-08');
    for (const call of prisma.expense.groupBy.mock.calls) expect(call[0].where.vendorId).toBe('vendor-x');
    for (const call of prisma.settlement.aggregate.mock.calls) expect(call[0].where.vendorId).toBe('vendor-x');
    for (const call of prisma.transaction.aggregate.mock.calls) expect(call[0].where.vendorId).toBe('vendor-x');
  });

  it('counts only POSTED cash-moving advance debits', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await service.getProfitLoss('v1', '2025-08');
    const where = prisma.staffLedgerEntry.aggregate.mock.calls[0][0].where;
    expect(where.status).toBe('POSTED');
    expect(where.amount).toEqual({ lt: 0 });
    expect(where.category).toEqual({ in: ['ADVANCE', 'ADVANCE_DISBURSEMENT'] });
  });

  it('rejects a malformed month and an unknown detail category', async () => {
    const { service } = makeService(makePrisma());
    await expect(service.getProfitLoss('v1', '2025-13')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getDetails('v1', '2025-08', 'NOT_A_CATEGORY')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serves the cached payload without touching the database', async () => {
    const prisma = makePrisma();
    const { service, cache } = makeService(prisma);
    cache.get.mockResolvedValue({ cached: true });
    await expect(service.getProfitLoss('v1', '2025-08')).resolves.toEqual({ cached: true });
    expect(prisma.expense.groupBy).not.toHaveBeenCalled();
  });

  it('detail rows for an Expense category use the same month window as the summary', async () => {
    const prisma = makePrisma();
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 213483 }, _count: { _all: 1 } });
    prisma.expense.findMany.mockResolvedValue([
      {
        id: 'e1',
        amount: 213483,
        description: 'Fuel fill',
        date: new Date('2025-08-10T00:00:00Z'),
        paidFromCash: true,
        dailySheetId: null,
        van: { plateNumber: 'ABC-123' },
        createdBy: { name: 'Ali' },
        fuelLog: { id: 'f1' },
        vehicleServiceRecord: null,
        extraLabour: null,
      },
    ]);
    const { service } = makeService(prisma);
    const r = await service.getDetails('v1', '2025-08', ExpenseCategory.FUEL_EXPENSE);
    expect(r.total).toBe(213483);
    expect(r.domain).toBe('VEHICLE');
    expect(r.rows[0]).toMatchObject({ source: 'Fleet', vanPlateNumber: 'ABC-123' });
    const where = prisma.expense.findMany.mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe('2025-07-31T19:00:00.000Z');
  });
});
