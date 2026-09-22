import { SupplierBillService } from './supplier-bill.service';
import { currentPeriodLabel, periodBounds } from './cash-ledger-period.util';

// Month-wise Plant/Caps bill status (owner request 2026-09-22). Anchored to
// the REAL current PKT month (via cash-ledger-period.util, same as the
// service under test) rather than a fixed fixture month, so the suite never
// goes stale — every "before"/"this month" fixture date is derived from
// `curMonthStart` below.

const VENDOR_ID = 'vendor-001';
const PRODUCT_ID = 'product-001';

const { startDate: curMonthStart } = periodBounds(currentPeriodLabel());
const beforeThisMonth = new Date(curMonthStart.getTime() - 24 * 60 * 60 * 1000); // last day of the prior month
const withinThisMonth = new Date(curMonthStart.getTime() + 24 * 60 * 60 * 1000); // 2nd day of this month

function costRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    productId: PRODUCT_ID,
    costPerUnit: 10,
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    ...overrides,
  };
}

function deliveryItem(overrides: Partial<Record<string, any>> = {}) {
  return {
    productId: PRODUCT_ID,
    filledDropped: 10,
    dailySheet: { date: beforeThisMonth },
    ...overrides,
  };
}

function makeService(opts: {
  deliveryItems?: any[];
  bottleCostRows?: any[];
  capCostRows?: any[];
  bottlePaidBefore?: number;
  bottlePaidThisMonth?: number;
  capPaidBefore?: number;
  capPaidThisMonth?: number;
}) {
  const prisma = {
    dailySheetItem: { findMany: jest.fn().mockResolvedValue(opts.deliveryItems ?? []) },
    productCost: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(where?.kind === 'CAP' ? (opts.capCostRows ?? []) : (opts.bottleCostRows ?? []));
      }),
    },
    expense: {
      aggregate: jest.fn().mockImplementation(({ where }: any) => {
        const isCap = where?.category === 'CAPS_PURCHASED';
        const isBefore = !!where?.date?.lt;
        const amount = isCap
          ? isBefore ? (opts.capPaidBefore ?? 0) : (opts.capPaidThisMonth ?? 0)
          : isBefore ? (opts.bottlePaidBefore ?? 0) : (opts.bottlePaidThisMonth ?? 0);
        return Promise.resolve({ _sum: { amount } });
      }),
    },
  };
  return new SupplierBillService(prisma as any);
}

describe('SupplierBillService', () => {
  it('the owner\'s worked example: prev bill 1000, this month bill 200, paid 1100 this month → prev cleared, 100 left pending this month', async () => {
    const svc = makeService({
      deliveryItems: [
        deliveryItem({ filledDropped: 100, dailySheet: { date: beforeThisMonth } }), // 100 * 10 = 1000 (prev)
        deliveryItem({ filledDropped: 20, dailySheet: { date: withinThisMonth } }), // 20 * 10 = 200 (this month)
      ],
      bottleCostRows: [costRow()],
      bottlePaidThisMonth: 1100,
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant).toEqual({
      prevMonthPending: 0,
      currentMonthBill: 200,
      currentMonthPending: 100,
      totalPending: 100,
    });
  });

  it('underpayment: prev bill 1000, this month bill 200, paid 500 this month → prev still owes 500, current month untouched', async () => {
    const svc = makeService({
      deliveryItems: [
        deliveryItem({ filledDropped: 100, dailySheet: { date: beforeThisMonth } }),
        deliveryItem({ filledDropped: 20, dailySheet: { date: withinThisMonth } }),
      ],
      bottleCostRows: [costRow()],
      bottlePaidThisMonth: 500,
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant).toEqual({
      prevMonthPending: 500,
      currentMonthBill: 200,
      currentMonthPending: 200,
      totalPending: 700,
    });
  });

  it('a backlog from BEFORE the immediately-prior month is still bucketed as prevMonthPending (not silently dropped)', async () => {
    const svc = makeService({
      deliveryItems: [deliveryItem({ filledDropped: 50, dailySheet: { date: beforeThisMonth } })], // 500
      bottleCostRows: [costRow()],
      bottlePaidBefore: 200, // only partially paid, historically
      bottlePaidThisMonth: 0,
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant.prevMonthPending).toBe(300); // 500 - 200
    expect(result.plant.currentMonthBill).toBe(0);
    expect(result.plant.currentMonthPending).toBe(0);
  });

  it('an advance/overpayment beyond prev pending rolls forward as a credit against THIS month\'s bill', async () => {
    const svc = makeService({
      deliveryItems: [deliveryItem({ filledDropped: 20, dailySheet: { date: withinThisMonth } })], // 200 this month, nothing before
      bottleCostRows: [costRow()],
      bottlePaidThisMonth: 150,
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant).toEqual({
      prevMonthPending: 0,
      currentMonthBill: 200,
      currentMonthPending: 50,
      totalPending: 50,
    });
  });

  it('bottle and cap are computed independently — a bottle payment never reduces the cap bucket', async () => {
    const svc = makeService({
      deliveryItems: [deliveryItem({ filledDropped: 100, dailySheet: { date: beforeThisMonth } })],
      bottleCostRows: [costRow({ costPerUnit: 10 })], // 1000 bottle cost
      capCostRows: [costRow({ costPerUnit: 2 })], // 200 cap cost
      bottlePaidThisMonth: 1000, // fully clears bottle
      capPaidThisMonth: 0, // caps untouched
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant.prevMonthPending).toBe(0);
    expect(result.caps.prevMonthPending).toBe(200);
  });

  it('a delivery with no covering ProductCost row contributes zero, never a fabricated cost', async () => {
    const svc = makeService({
      deliveryItems: [deliveryItem({ filledDropped: 100, dailySheet: { date: beforeThisMonth } })],
      bottleCostRows: [], // no cost history at all
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant.prevMonthPending).toBe(0);
    expect(result.plant.totalPending).toBe(0);
  });
});
