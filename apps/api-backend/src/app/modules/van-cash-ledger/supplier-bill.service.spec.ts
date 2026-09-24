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
  openingBalance?: { plantAmount?: number; capsAmount?: number; note?: string | null } | null;
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
    supplierBillOpeningBalance: {
      findUnique: jest.fn().mockResolvedValue(
        opts.openingBalance === undefined
          ? null
          : opts.openingBalance === null
            ? null
            : {
                id: 'opening-balance-001',
                vendorId: VENDOR_ID,
                plantAmount: opts.openingBalance.plantAmount ?? 0,
                capsAmount: opts.openingBalance.capsAmount ?? 0,
                note: opts.openingBalance.note ?? null,
                createdAt: new Date('2026-09-01'),
                updatedAt: new Date('2026-09-01'),
              },
      ),
      upsert: jest.fn(),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return new SupplierBillService(prisma as any, audit as any);
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
      prevMonthBottles: 100,
      currentMonthBottles: 20,
      openingBalance: 0,
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
      prevMonthBottles: 100,
      currentMonthBottles: 20,
      openingBalance: 0,
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
      prevMonthBottles: 0,
      currentMonthBottles: 20,
      openingBalance: 0,
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
    expect(result.plant.prevMonthBottles).toBe(0); // uncosted delivery never counted, same as its ₨0 cost
  });

  it('bottle count (owner request 2026-09-23) tracks each bucket\'s own kind independently — a costed bottle count is not shared with an uncosted cap count', async () => {
    const svc = makeService({
      deliveryItems: [
        deliveryItem({ filledDropped: 30, dailySheet: { date: beforeThisMonth } }),
        deliveryItem({ filledDropped: 15, dailySheet: { date: withinThisMonth } }),
      ],
      bottleCostRows: [costRow({ costPerUnit: 10 })], // bottle cost exists
      capCostRows: [], // cap cost history not entered yet
    });

    const result = await svc.getSupplierBillStatus(VENDOR_ID);

    expect(result.plant.prevMonthBottles).toBe(30);
    expect(result.plant.currentMonthBottles).toBe(15);
    expect(result.caps.prevMonthBottles).toBe(0);
    expect(result.caps.currentMonthBottles).toBe(0);
  });

  describe('opening balance (owner request 2026-09-25)', () => {
    it('the exact bug reported: a fresh vendor with no in-system history before this month sets a 10,000 opening balance for a pre-tracking debt, then pays 10,000 this month → it clears the OPENING balance, not this month\'s own bill', async () => {
      const svc = makeService({
        deliveryItems: [deliveryItem({ filledDropped: 19, dailySheet: { date: withinThisMonth } })], // 19 * 100 = 1900, this month only
        bottleCostRows: [costRow({ costPerUnit: 100 })],
        bottlePaidThisMonth: 10000, // meant to settle the pre-tracking (e.g. August) debt
        openingBalance: { plantAmount: 10000 },
      });

      const result = await svc.getSupplierBillStatus(VENDOR_ID);

      expect(result.plant).toEqual({
        prevMonthPending: 0, // the 10,000 opening balance is fully cleared
        currentMonthBill: 1900,
        currentMonthPending: 1900, // untouched — none of the payment leaks onto it
        totalPending: 1900,
        prevMonthBottles: 0,
        currentMonthBottles: 19,
        openingBalance: 10000,
      });
    });

    it('a partial payment against the opening balance leaves the remainder pending, still without touching the current month\'s bill', async () => {
      const svc = makeService({
        deliveryItems: [deliveryItem({ filledDropped: 19, dailySheet: { date: withinThisMonth } })],
        bottleCostRows: [costRow({ costPerUnit: 100 })],
        bottlePaidThisMonth: 6000,
        openingBalance: { plantAmount: 10000 },
      });

      const result = await svc.getSupplierBillStatus(VENDOR_ID);

      expect(result.plant.prevMonthPending).toBe(4000); // 10,000 - 6,000
      expect(result.plant.currentMonthPending).toBe(1900);
      expect(result.plant.totalPending).toBe(5900);
    });

    it('caps opening balance is independent of plant\'s', async () => {
      const svc = makeService({
        deliveryItems: [],
        openingBalance: { plantAmount: 500, capsAmount: 300 },
      });

      const result = await svc.getSupplierBillStatus(VENDOR_ID);

      expect(result.plant.openingBalance).toBe(500);
      expect(result.plant.prevMonthPending).toBe(500);
      expect(result.caps.openingBalance).toBe(300);
      expect(result.caps.prevMonthPending).toBe(300);
    });

    it('no opening balance ever set (the default, existing vendors) behaves exactly as before — 0, no change', async () => {
      const svc = makeService({
        deliveryItems: [deliveryItem({ filledDropped: 100, dailySheet: { date: beforeThisMonth } })],
        bottleCostRows: [costRow()],
        openingBalance: null,
      });

      const result = await svc.getSupplierBillStatus(VENDOR_ID);

      expect(result.plant.openingBalance).toBe(0);
      expect(result.plant.prevMonthPending).toBe(1000);
    });

    describe('setOpeningBalance / getOpeningBalance', () => {
      it('getOpeningBalance defaults to zero amounts when no row exists yet', async () => {
        const svc = makeService({ openingBalance: null });
        const result = await svc.getOpeningBalance(VENDOR_ID);
        expect(result).toEqual({ plantAmount: 0, capsAmount: 0, note: null, updatedAt: null });
      });

      it('setOpeningBalance upserts the row and writes an audit log entry', async () => {
        const svc: any = makeService({ openingBalance: null });
        const upserted = {
          id: 'ob-1',
          plantAmount: 10000,
          capsAmount: 500,
          note: 'Carried over from before software',
          updatedAt: new Date('2026-09-25'),
        };
        svc.prisma.supplierBillOpeningBalance.upsert.mockResolvedValue(upserted);

        const user = { vendorId: VENDOR_ID, userId: 'user-1', name: 'Admin' };
        const result = await svc.setOpeningBalance(user, {
          plantAmount: 10000,
          capsAmount: 500,
          note: 'Carried over from before software',
        });

        expect(svc.prisma.supplierBillOpeningBalance.upsert).toHaveBeenCalledWith({
          where: { vendorId: VENDOR_ID },
          create: { vendorId: VENDOR_ID, plantAmount: 10000, capsAmount: 500, note: 'Carried over from before software' },
          update: { plantAmount: 10000, capsAmount: 500, note: 'Carried over from before software' },
        });
        expect(svc.audit.log).toHaveBeenCalledWith(
          expect.objectContaining({ vendorId: VENDOR_ID, action: 'CREATED', entity: 'SupplierBillOpeningBalance' }),
        );
        expect(result).toEqual({
          plantAmount: 10000,
          capsAmount: 500,
          note: 'Carried over from before software',
          updatedAt: '2026-09-25T00:00:00.000Z',
        });
      });
    });
  });
});
