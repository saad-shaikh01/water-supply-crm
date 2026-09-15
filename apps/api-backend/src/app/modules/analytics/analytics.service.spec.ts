import { AnalyticsService } from './analytics.service';

// Focused coverage for the Historical Product Cost & COGS addition to
// getFinancial() (docs/features/product-cost-history-and-cogs.md §3/§5) —
// not a full re-test of every existing field in that (large, pre-existing)
// function. Mirrors the mocking style used in
// ../product-cost/product-cost.service.spec.ts.

const VENDOR_ID = 'vendor-001';
const PRODUCT_ID = 'product-001';

function productCostRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'cost-1',
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    costPerUnit: 100,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    voidedAt: null,
    ...overrides,
  };
}

function deliveryItem(overrides: Partial<Record<string, any>> = {}) {
  return {
    cashCollected: 0,
    filledDropped: 10,
    pricePerBottle: 150,
    customer: { paymentType: 'CASH' },
    product: { id: PRODUCT_ID, name: 'Bottle 19L' },
    dailySheet: { date: new Date('2026-01-10T00:00:00.000Z') },
    ...overrides,
  };
}

/**
 * Builds a minimal-but-complete Prisma mock for getFinancial(): every query
 * the function issues gets a sensible zero/empty default so the function
 * runs end-to-end without touching a real DB, with `deliveryItems` and
 * `productCost` driven by test fixtures (the two inputs this suite actually
 * exercises). `dailySheetItem.findMany` is called twice in the real
 * function for two different purposes (the COGS/revenue source, and the
 * post-close hybrid-cash-rollup "modItems" check) — distinguished here by
 * `select` shape, mirroring the two distinct call sites in the source.
 */
function makePrisma(opts: { deliveryItems?: any[]; costRows?: any[]; transactions?: any[] }) {
  const deliveryItems = opts.deliveryItems ?? [];
  const costRows = opts.costRows ?? [];
  const transactions = opts.transactions ?? [];

  return {
    transaction: {
      findMany: jest.fn().mockResolvedValue(transactions),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    expense: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    dailySheet: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    customer: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { financialBalance: 0 } }),
    },
    dailySheetItem: {
      findMany: jest.fn().mockImplementation(({ select }: any) =>
        Promise.resolve(
          select?.dailySheetId === true && Object.keys(select).length === 1 ? [] : deliveryItems,
        ),
      ),
    },
    dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
    crewCashDistribution: { findMany: jest.fn().mockResolvedValue([]) },
    payrollEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { finalPayable: 0 } }) },
    sheetDiscrepancyCase: { findMany: jest.fn().mockResolvedValue([]) },
    productCost: { findMany: jest.fn().mockResolvedValue(costRows) },
  };
}

function makeService(opts: { deliveryItems?: any[]; costRows?: any[]; transactions?: any[] }) {
  const prisma = makePrisma(opts);
  const cache = {
    vendorKey: jest.fn((_v: string, k: string) => k),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const vanCashLedger = {
    getStats: jest.fn().mockResolvedValue({
      availableBalance: 0,
      totalExpense: 0,
      totalCashIn: 0,
      totalRemitted: 0,
      pendingHandoverCount: 0,
      pendingRemittanceCount: 0,
    }),
  };
  const svc = new AnalyticsService(prisma as any, cache as any, vanCashLedger as any);
  return { svc, prisma };
}

describe('AnalyticsService.getFinancial() — COGS (Historical Product Cost & COGS)', () => {
  it('computes cogs.total/byProduct/uncostedBottles/coverage from a mix of costed and uncosted deliveries', async () => {
    const items = [
      deliveryItem({ filledDropped: 10, pricePerBottle: 150, dailySheet: { date: new Date('2026-01-10') } }), // costed
      deliveryItem({
        product: { id: 'product-002', name: 'No Cost Product' },
        filledDropped: 5,
        pricePerBottle: 200,
        dailySheet: { date: new Date('2026-01-10') },
      }), // uncosted — no ProductCost row exists for product-002
    ];
    const { svc } = makeService({
      deliveryItems: items,
      costRows: [productCostRow({ costPerUnit: 100 })], // only covers product-001
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.cogs.total).toBe(1000); // 10 * 100
    expect(result.cogs.uncostedBottles).toBe(5);
    expect(result.cogs.isPartial).toBe(true);
    expect(result.cogs.coverage).toBe(67); // 10 costed / 15 delivered, rounded

    const costed = result.cogs.byProduct.find((p: any) => p.productId === PRODUCT_ID);
    expect(costed).toMatchObject({ bottlesDelivered: 10, bottlesCosted: 10, costTotal: 1000 });
    const uncosted = result.cogs.byProduct.find((p: any) => p.productId === 'product-002');
    expect(uncosted).toMatchObject({ bottlesDelivered: 5, bottlesCosted: 0, costTotal: 0 });
  });

  it('returns grossProfit/grossProfitMargin = null at 0% coverage (no cost history at all)', async () => {
    const items = [deliveryItem({ filledDropped: 10, pricePerBottle: 150 })];
    const { svc } = makeService({
      deliveryItems: items,
      costRows: [], // no cost history for any product in range
      transactions: [
        {
          amount: 1500,
          createdAt: new Date('2026-01-10'),
          customerId: 'c1',
          customer: { paymentType: 'CASH' },
          dailySheet: { date: new Date('2026-01-10') },
        },
      ],
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.cogs.coverage).toBe(0);
    expect(result.cogs.isPartial).toBe(true);
    expect(result.grossProfit).toBeNull();
    expect(result.grossProfitMargin).toBeNull();
  });

  it('isPartial is false and grossProfit is a real number at full coverage', async () => {
    const items = [deliveryItem({ filledDropped: 10, pricePerBottle: 150 })];
    const { svc } = makeService({
      deliveryItems: items,
      costRows: [productCostRow({ costPerUnit: 100 })],
      transactions: [
        {
          amount: 1500,
          createdAt: new Date('2026-01-10'),
          customerId: 'c1',
          customer: { paymentType: 'CASH' },
          dailySheet: { date: new Date('2026-01-10') },
        },
      ],
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.cogs.isPartial).toBe(false);
    expect(result.cogs.coverage).toBe(100);
    expect(result.grossProfit).toBe(500); // 1500 revenue - 1000 cogs
    expect(result.grossProfitMargin).toBe(33); // round(500 / 1500 * 100)
  });

  it('resolves the correct cost row on both sides of a backdated cost correction split', async () => {
    // Simulates the result of a backdated ProductCost insert (design doc
    // §4.1 case 4): the range 1 Jan -> open got split into 1-14 Jan @100 and
    // 15 Jan -> open @105.
    const costRows = [
      productCostRow({ id: 'cost-1', costPerUnit: 100, effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-01-14') }),
      productCostRow({ id: 'cost-2', costPerUnit: 105, effectiveFrom: new Date('2026-01-15'), effectiveTo: null }),
    ];
    const items = [
      deliveryItem({ filledDropped: 4, pricePerBottle: 150, dailySheet: { date: new Date('2026-01-10') } }), // before the split
      deliveryItem({ filledDropped: 6, pricePerBottle: 150, dailySheet: { date: new Date('2026-01-20') } }), // after the split
    ];
    const { svc } = makeService({ deliveryItems: items, costRows });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.cogs.total).toBe(4 * 100 + 6 * 105); // 400 + 630 = 1030
    expect(result.cogs.uncostedBottles).toBe(0);
    expect(result.cogs.coverage).toBe(100);
  });

  it('leaves profitTotal/profitMargin/netProfit/netProfitMargin/payrollCost unaffected by COGS', async () => {
    const items = [deliveryItem({ filledDropped: 10, pricePerBottle: 150 })];
    const { svc } = makeService({
      deliveryItems: items,
      costRows: [productCostRow({ costPerUnit: 100 })],
      transactions: [
        {
          amount: 1500,
          createdAt: new Date('2026-01-10'),
          customerId: 'c1',
          customer: { paymentType: 'CASH' },
          dailySheet: { date: new Date('2026-01-10') },
        },
      ],
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    // No expenses/payroll mocked in this fixture -> profitTotal = totalRevenue,
    // untouched by the new grossProfit/cogs computation (1500 - 0 = 1500,
    // independent of cogs.total = 1000).
    expect(result.profit.total).toBe(1500);
    expect(result.profitMargin).toBe(100);
    expect(result.payrollCost).toBe(0);
    expect(result.netProfit).toBe(1500);
    expect(result.netProfitMargin).toBe(100);
  });
});
