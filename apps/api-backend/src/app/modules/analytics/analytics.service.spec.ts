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
 * exercises). `dailySheetItem.findMany` is called THREE times in the real
 * function for three different purposes — distinguished here by `select`
 * shape, mirroring the distinct call sites in the source:
 *   1. the post-close hybrid-cash-rollup "modItems" check (`{dailySheetId:
 *      true}` only);
 *   2. the period-scoped COGS/revenue source (full shape: `product`,
 *      `customer`, etc. nested selects) — driven by `opts.deliveryItems`;
 *   3. the Plant Balance all-time scan (flat `productId`/`filledDropped` +
 *      `dailySheet.date`, no `product`/`customer` nested selects) — driven
 *      by `opts.allTimeDeliveryItems` (defaults to `opts.deliveryItems` when
 *      a test doesn't care about the distinction).
 */
function makePrisma(opts: {
  deliveryItems?: any[];
  allTimeDeliveryItems?: any[];
  costRows?: any[];
  allTimeCostRows?: any[];
  transactions?: any[];
  plantPaidTotal?: number;
}) {
  const deliveryItems = opts.deliveryItems ?? [];
  const allTimeDeliveryItems = opts.allTimeDeliveryItems ?? deliveryItems;
  const costRows = opts.costRows ?? [];
  const allTimeCostRows = opts.allTimeCostRows ?? costRows;
  const transactions = opts.transactions ?? [];

  return {
    transaction: {
      findMany: jest.fn().mockResolvedValue(transactions),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    expense: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.plantPaidTotal ?? 0 } }),
    },
    dailySheet: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    customer: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { financialBalance: 0 } }),
    },
    dailySheetItem: {
      findMany: jest.fn().mockImplementation(({ select }: any) => {
        if (select?.dailySheetId === true && Object.keys(select).length === 1) {
          return Promise.resolve([]); // modItems check
        }
        if (select?.productId === true && !select?.product && !select?.customer) {
          return Promise.resolve(allTimeDeliveryItems); // Plant Balance all-time scan
        }
        return Promise.resolve(deliveryItems); // period-scoped COGS/revenue source
      }),
    },
    dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
    crewCashDistribution: { findMany: jest.fn().mockResolvedValue([]) },
    payrollEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { finalPayable: 0 } }) },
    sheetDiscrepancyCase: { findMany: jest.fn().mockResolvedValue([]) },
    productCost: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        // Period-scoped query filters by `productId: { in: [...] }`; the
        // all-time Plant Balance query has no `productId` filter at all —
        // distinguish on that, same idea as the dailySheetItem branching above.
        return Promise.resolve(where?.productId ? costRows : allTimeCostRows);
      }),
    },
  };
}

function makeService(opts: {
  deliveryItems?: any[];
  allTimeDeliveryItems?: any[];
  costRows?: any[];
  allTimeCostRows?: any[];
  transactions?: any[];
  plantPaidTotal?: number;
}) {
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
      totalFuelCardTopUps: 0,
      totalStandaloneCrewCash: 0,
      sheetCashIn: 0,
      officeCashIn: 0,
      officeExpenses: 0,
      payrollCash: 0,
      crewCash: 0,
      broughtForward: 0,
      expectedClosing: 0,
    }),
  };
  const svc = new AnalyticsService(prisma as any, cache as any, vanCashLedger as any);
  return { svc, prisma, vanCashLedger };
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

describe('AnalyticsService.getFinancial() — Plant Balance (owner-requested 2026-09-15 follow-up)', () => {
  it('computes outstanding = all-time COGS minus all-time BOTTLE_PURCHASED payments', async () => {
    const { svc } = makeService({
      // Period-scoped deliveryItems (irrelevant here, kept minimal) vs the
      // ALL-TIME set used for Plant Balance — deliberately different sizes to
      // prove plantBalance is not scoped by the getFinancial() date filter.
      deliveryItems: [deliveryItem({ filledDropped: 1 })],
      allTimeDeliveryItems: [
        { productId: PRODUCT_ID, filledDropped: 20, dailySheet: { date: new Date('2025-06-01') } }, // outside the requested Jan-2026 range
        { productId: PRODUCT_ID, filledDropped: 10, dailySheet: { date: new Date('2026-01-10') } },
      ],
      allTimeCostRows: [productCostRow({ costPerUnit: 100, effectiveFrom: new Date('2025-01-01'), effectiveTo: null })],
      plantPaidTotal: 2000, // already paid Rs.2000 toward the plant
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.plantBalance.totalCogs).toBe(3000); // (20 + 10) * 100, all-time, ignoring the date filter
    expect(result.plantBalance.totalPaid).toBe(2000);
    expect(result.plantBalance.outstanding).toBe(1000); // 3000 - 2000 still owed
  });

  it('outstanding goes negative (a credit/advance) when payments exceed cost incurred, without erroring', async () => {
    const { svc } = makeService({
      deliveryItems: [],
      allTimeDeliveryItems: [{ productId: PRODUCT_ID, filledDropped: 5, dailySheet: { date: new Date('2026-01-10') } }],
      allTimeCostRows: [productCostRow({ costPerUnit: 100 })],
      plantPaidTotal: 1000, // paid 1000 for only 500 worth of cost
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.plantBalance.totalCogs).toBe(500);
    expect(result.plantBalance.totalPaid).toBe(1000);
    expect(result.plantBalance.outstanding).toBe(-500);
  });

  it('an all-time delivery with no covering cost row is silently excluded from totalCogs (never fabricated)', async () => {
    const { svc } = makeService({
      deliveryItems: [],
      allTimeDeliveryItems: [{ productId: 'uncosted-product', filledDropped: 100, dailySheet: { date: new Date('2026-01-10') } }],
      allTimeCostRows: [], // no cost history for this product at all
      plantPaidTotal: 0,
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.plantBalance.totalCogs).toBe(0);
    expect(result.plantBalance.outstanding).toBe(0);
  });

  it('sums BOTTLE_PURCHASED and BOTTLE_REFILL_PAYMENT together for totalPaid (2026-09-17 category split)', async () => {
    const { svc, prisma } = makeService({
      deliveryItems: [],
      allTimeDeliveryItems: [],
      allTimeCostRows: [],
      plantPaidTotal: 500, // combined mock total for both categories
    });

    await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    const plantPaidCall = (prisma.expense.aggregate as jest.Mock).mock.calls.find(
      ([args]) => args?.where?.category?.in,
    );
    expect(plantPaidCall?.[0].where.category.in).toEqual(
      expect.arrayContaining(['BOTTLE_PURCHASED', 'BOTTLE_REFILL_PAYMENT']),
    );
  });
});

describe('AnalyticsService.getFinancial() — officeCash block (Cash Ledger P0 pass-through)', () => {
  it('keeps every existing officeCash key and passes through the new breakdown fields', async () => {
    const { svc, vanCashLedger } = makeService({});
    vanCashLedger.getStats.mockResolvedValue({
      availableBalance: 12200,
      totalExpense: 2600, // office + payroll + crew
      totalCashIn: 3000, // sheet + office
      totalRemitted: 1000,
      pendingHandoverCount: 2,
      pendingRemittanceCount: 1,
      totalFuelCardTopUps: 200,
      totalStandaloneCrewCash: 100,
      sheetCashIn: 2500,
      officeCashIn: 500,
      officeExpenses: 500,
      payrollCash: 2000,
      crewCash: 100,
      broughtForward: 13000,
      expectedClosing: 12200,
    });

    const result = await svc.getFinancial(VENDOR_ID, '2026-01-01', '2026-01-31');

    expect(result.officeCash).toEqual({
      scope: 'OFFICE',
      available: 12200,
      periodExpense: 2600,
      periodCashIn: 3000,
      periodRemitted: 1000,
      pendingHandoverCount: 2,
      pendingRemittanceCount: 1,
      periodCrewCash: 100,
      periodPayrollCash: 2000,
      periodOfficeCashIn: 500,
      periodSheetCashIn: 2500,
    });
  });
});
