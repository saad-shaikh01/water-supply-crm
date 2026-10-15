import { CustomerService } from './customer.service';

const VENDOR_ID = 'vendor-001';
const PRODUCT = { id: 'p1', name: '19L', basePrice: 100 };

const CUSTOMERS = [
  { id: 'c-cash-owes', paymentType: 'CASH', financialBalance: 500 },
  { id: 'c-cash-advance', paymentType: 'CASH', financialBalance: -200 },
  // MONTHLY: balance 1000, this month's txns 400 → opening 600, paid 100 → pending 500
  { id: 'c-monthly', paymentType: 'MONTHLY', financialBalance: 1000 },
];

function makeService(customers = CUSTOMERS, activeProducts = [PRODUCT]) {
  const prisma = {
    customer: { findMany: jest.fn().mockResolvedValue(customers) },
    product: {
      findFirst: jest.fn().mockResolvedValue(PRODUCT),
      findMany: jest.fn().mockResolvedValue(activeProducts),
    },
    transaction: {
      // computePrevMonthOutstanding: first call = month txns, second = month payments
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ customerId: 'c-monthly', _sum: { amount: 400 } }])
        .mockResolvedValueOnce([{ customerId: 'c-monthly', _sum: { amount: -100 } }]),
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { filledDropped: 30 } })
        .mockResolvedValueOnce({ _sum: { filledDropped: 45 } }),
    },
    bottleWallet: { aggregate: jest.fn().mockResolvedValue({ _sum: { balance: 12 } }) },
    customerProductPrice: {
      findMany: jest.fn().mockResolvedValue([{ customerId: 'c-cash-owes', customPrice: 160 }]),
    },
  };
  const svc = new CustomerService(
    prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { svc, prisma };
}

describe('CustomerService.getListStats', () => {
  it('totals every matching customer using the list pending rule (MONTHLY prev-month, CASH live balance)', async () => {
    const { svc } = makeService();
    const stats = await svc.getListStats(VENDOR_ID, {} as any);

    expect(stats.count).toBe(3);
    expect(stats.payment).toEqual({ total: 1300, owed: 1500, credit: 200 });
    expect(stats.pending).toEqual({ total: 500 + 500 + -200, monthly: 500, cash: 300 });
    expect(stats.bottleBalance.total).toBe(12);
    expect(stats.sold).toEqual({ thisMonth: 30, prevMonth: 45 });
  });

  it('averages the rate (override else base price) and defaults to the vendor\'s only active product', async () => {
    const { svc, prisma } = makeService();
    const stats = await svc.getListStats(VENDOR_ID, {} as any);

    // (160 + 100 + 100) / 3
    expect(stats.rate).toEqual({ avg: 120, min: 100, max: 160, productName: '19L' });
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  it('returns no rate when several products exist and none is selected', async () => {
    const { svc } = makeService(CUSTOMERS, [PRODUCT, { ...PRODUCT, id: 'p2', name: '6L' }]);
    const stats = await svc.getListStats(VENDOR_ID, {} as any);
    expect(stats.rate).toBeNull();
  });

  it('applies the same filters as the list and handles an empty result', async () => {
    const { svc, prisma } = makeService([]);
    prisma.transaction.groupBy.mockReset().mockResolvedValue([]);
    prisma.transaction.aggregate.mockReset().mockResolvedValue({ _sum: { filledDropped: null } });
    prisma.bottleWallet.aggregate.mockResolvedValue({ _sum: { balance: null } });

    const stats = await svc.getListStats(VENDOR_ID, { paymentType: 'CASH', routeId: 'r1' } as any);

    expect(prisma.customer.findMany.mock.calls[0][0].where).toMatchObject({
      vendorId: VENDOR_ID,
      paymentType: 'CASH',
      routeId: 'r1',
    });
    expect(stats.count).toBe(0);
    expect(stats.payment.total).toBe(0);
    expect(stats.bottleBalance.total).toBe(0);
    expect(stats.rate).toBeNull();
  });
});
