import { BadRequestException } from '@nestjs/common';
import { ExpenseCategory } from '@prisma/client';
import { ProfitLossService } from './profit-loss.service';

const agg = (sum: Record<string, number | null>, count = 0) => Promise.resolve({ _sum: sum, _count: { _all: count } });

function makePrisma() {
  return {
    transaction: {
      aggregate: jest.fn().mockImplementation((args: any) => {
        if (args.where.type === 'DELIVERY') return agg({ amount: 1853490, filledDropped: 10000, filledReceived: 35 });
        // PAYMENT: the "on a delivery sheet" query carries dailySheetItemId: { not: null }
        if (args.where.dailySheetItemId) return agg({ amount: -1006910 }, 731);
        return agg({ amount: -1758760 }, 1041);
      }),
      groupBy: jest.fn().mockResolvedValue([
        { paymentMode: 'CASH', _sum: { amount: -81370 }, _count: { _all: 7 } },
        { paymentMode: 'BANK_TRANSFER', _sum: { amount: -670480 }, _count: { _all: 303 } },
      ]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    dailySheetItem: { aggregate: jest.fn().mockImplementation(() => agg({ cashCollected: 1006910 })) },
    dailySheet: {
      aggregate: jest.fn().mockImplementation(() => Promise.resolve({ _sum: { cashCollected: 904710 }, _count: { _all: 86 } })),
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
    payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
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

function makeService(prisma: any, accrual?: any) {
  const cache = {
    vendorKey: (_v: string, k: string) => k,
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const zero = { bill: 0, paidInMonth: 0, priorPaid: 0, pending: 0, priorPaidByMonth: [], earlierPendingByMonth: [] };
  const supplierBills = { getMonthAccrual: jest.fn().mockResolvedValue(accrual ?? { plant: zero, caps: zero }) };
  return { service: new ProfitLossService(prisma, cache as any, supplierBills as any), cache };
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

  it('proves Amount Received: delivery-sheet payments + recorded payments by mode add up to the total', async () => {
    const { service } = makeService(makePrisma());
    const r = await service.getProfitLoss('v1', '2025-08');
    const recorded = r.receivedBreakdown.recorded.reduce((s: number, x: any) => s + x.amount, 0);
    expect(r.receivedBreakdown.onSheets).toEqual({ amount: 1006910, count: 731 });
    expect(r.receivedBreakdown.recorded).toEqual([
      { mode: 'CASH', amount: 81370, count: 7 },
      { mode: 'BANK_TRANSFER', amount: 670480, count: 303 },
    ]);
    expect(r.receivedBreakdown.onSheets.amount + recorded).toBe(r.summary.amountReceived - (1758760 - 1006910 - recorded));
    expect(r.summary.receivedOnSheets).toBe(1006910);
    expect(r.summary.receivedRecorded).toBe(1758760 - 1006910);
  });

  it('ties delivery cash to the drivers hand-in using the same arithmetic as the sheet reconciliation', async () => {
    const prisma = makePrisma();
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 24925 } });
    prisma.crewCashDistribution.aggregate.mockImplementation(() => agg({ amount: 35325 }, 6));
    const { service } = makeService(prisma);
    const r = await service.getProfitLoss('v1', '2026-09');
    expect(r.handoverReconciliation).toMatchObject({
      sheetCount: 86,
      deliveryCashRecorded: 1006910,
      vanCashExpenses: 24925,
      crewCashPaid: 35325,
      expectedHandIn: 946660,
      actualHandedIn: 904710,
      difference: 41950,
    });
    // Only van-paid (paidFromCash) expenses on sheets reduce the hand-in.
    const expWhere = prisma.expense.aggregate.mock.calls.find((c: any[]) => c[0].where.paidFromCash === true)?.[0].where;
    expect(expWhere.dailySheet.date.gte).toBeInstanceOf(Date);
  });

  it('lists every payment of a kind with the same month window and sign handling', async () => {
    const prisma = makePrisma();
    prisma.transaction.aggregate.mockImplementation(() => agg({ amount: -81370 }, 1));
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        amount: -81370,
        createdAt: new Date('2026-09-10T08:00:00Z'),
        paymentMode: 'CASH',
        description: 'Payment received',
        dailySheetId: null,
        dailySheetItemId: null,
        customer: { name: 'Ali', customerCode: 'C-1' },
      },
    ]);
    const { service } = makeService(prisma);
    const r = await service.getPayments('v1', '2026-09', 'CASH');
    expect(r.total).toBe(81370);
    expect(r.rows[0]).toMatchObject({ amount: 81370, customerName: 'Ali', mode: 'CASH' });
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ vendorId: 'v1', type: 'PAYMENT', dailySheetItemId: null, paymentMode: 'CASH' });
    await expect(service.getPayments('v1', '2026-09', 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
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

describe('ProfitLossService — actual cost adjustments', () => {
  const accrual = {
    plant: { bill: 400000, paidInMonth: 318880, priorPaid: 300000, pending: 381120, priorPaidByMonth: [], earlierPendingByMonth: [] },
    caps: { bill: 0, paidInMonth: 0, priorPaid: 0, pending: 0, priorPaidByMonth: [], earlierPendingByMonth: [] },
  };

  it('stays cash basis when no adjustment is selected, but lists the candidates', async () => {
    const { service } = makeService(makePrisma(), accrual);
    const r = await service.getProfitLoss('v1', '2026-09');
    expect(r.basis).toBe('CASH');
    expect(r.adjustmentTotal).toBe(0);
    expect(r.summary.totalExpenses).toBe(925346);
    expect(r.adjustments.find((a: any) => a.key === 'PLANT_PENDING')).toMatchObject({ amount: 381120, applied: false });
    expect((r as any).cashCategories).toBeUndefined();
  });

  it('removes prior-paid and adds pending when selected', async () => {
    const base = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09');
    const { service } = makeService(makePrisma(), accrual);
    const r = await service.getProfitLoss('v1', '2026-09', 'PLANT_PRIOR_PAID,PLANT_PENDING,BOGUS');
    expect(r.basis).toBe('ACTUAL');
    // the mocked cash refill payment is only 318,880, so the 300,000 prior-paid comes out of it
    expect(r.adjustmentTotal).toBe(381120 - 300000);
    expect(r.summary.totalExpenses).toBe(base.summary.totalExpenses + 81120);
    expect(r.adjustments.filter((a: any) => a.applied).map((a: any) => a.key).sort()).toEqual(['PLANT_PENDING', 'PLANT_PRIOR_PAID']);
    const refill = r.domains.flatMap((d: any) => d.categories).find((c: any) => c.key === 'BOTTLE_REFILL_PAYMENT');
    expect(refill.amount).toBe(318880 - 300000 + 381120);
    expect(refill.adjustment).toBe(81120);
    // trend and reconciliation remain cash basis
    expect(r.reconciliation.ok).toBe(true);
  });

  it('keeps row order stable whichever adjustments are ticked', async () => {
    const order = async (adjust?: string) => {
      const r = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09', adjust, 'ACTUAL');
      return r.domains.flatMap((d: any) => d.categories.map((c: any) => c.key));
    };
    const all = await order('PLANT_PRIOR_PAID,PLANT_PENDING,SALARY_PRIOR_PAID,SALARY_PENDING');
    expect(await order('PLANT_PENDING')).toEqual(all);
    expect(await order('PLANT_PRIOR_PAID')).toEqual(all);
    expect(await order(undefined)).toEqual(all);
  });
});

describe('ProfitLossService — what-if rate per bottle', () => {
  const zero = { bill: 0, paidInMonth: 0, priorPaid: 0, pending: 0, priorPaidByMonth: [], earlierPendingByMonth: [] };
  const accrual = {
    plant: { bill: 400000, paidInMonth: 318880, priorPaid: 300000, pending: 381120, priorPaidByMonth: [{ month: '2026-08', amount: 300000 }], earlierPendingByMonth: [{ month: '2026-08', amount: 50000 }] },
    caps: zero,
  };
  const refillOf = (r: any) => r.domains.flatMap((d: any) => d.categories).find((c: any) => c.key === 'BOTTLE_REFILL_PAYMENT');

  it('replaces the refill cost with rate x delivered bottles and sets the paid/unpaid rows aside', async () => {
    const base = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09', undefined, 'ACTUAL');
    const r = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09', 'PLANT_PENDING', 'ACTUAL', { plantRate: 23 });
    // mocked month: 10,000 delivered, 35 filled taken back
    expect(refillOf(r).amount).toBe(230000);
    expect(refillOf(r).simulated).toBe(true);
    expect(r.whatIf).toMatchObject({ basis: 'DELIVERED', bottles: 10000, plant: { rate: 23, amount: 230000 }, caps: null });
    expect(r.summary.totalExpenses).toBe(base.summary.totalExpenses - 318880 + 230000);
    expect(r.adjustments.filter((a: any) => a.group === 'PLANT').every((a: any) => a.superseded && !a.applied)).toBe(true);
  });

  it('can multiply the net bottle count instead', async () => {
    const r = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09', undefined, 'ACTUAL', { plantRate: 23, basis: 'NET' });
    expect(r.whatIf.bottles).toBe(9965);
    expect(refillOf(r).amount).toBe(229195);
  });

  it('is ignored on the cash view and keeps a plant/caps row even when there is nothing to adjust', async () => {
    const cash = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09', undefined, undefined, { plantRate: 23 });
    expect(cash.basis).toBe('CASH');
    expect(refillOf(cash).amount).toBe(318880);
    const { service } = makeService(makePrisma(), { plant: zero, caps: zero });
    const r = await service.getProfitLoss('v1', '2026-09', undefined, 'ACTUAL', { capsRate: 2 });
    expect(r.domains.flatMap((d: any) => d.categories).find((c: any) => c.key === 'CAPS_PURCHASED').amount).toBe(20000);
  });

  it('explains the overall balance vs the month own share', async () => {
    const r = await makeService(makePrisma(), accrual).service.getProfitLoss('v1', '2026-09');
    const pending = r.adjustments.find((a: any) => a.key === 'PLANT_PENDING');
    expect(pending.details).toEqual([{ label: expect.stringContaining('Aug 2026'), amount: 50000 }]);
    expect(pending.note).toContain('431,120');
    const paid = r.adjustments.find((a: any) => a.key === 'PLANT_PRIOR_PAID');
    expect(paid.details).toEqual([{ label: expect.stringContaining('Aug 2026'), amount: 300000 }]);
  });
});
