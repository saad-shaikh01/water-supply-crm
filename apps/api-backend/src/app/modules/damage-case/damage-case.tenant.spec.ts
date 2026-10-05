import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DamageCaseStatus, DamageCaseType } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { DamageCaseService } from './damage-case.service';

/**
 * Regression suite for audit finding H2: damage-case update / review / charge / waive loaded the
 * case by id alone, and report() stored unvalidated customer/product/item ids — so vendor A could
 * charge (move the balance of) or waive vendor B's customer.
 *
 * The prisma double below is a tiny in-memory model that HONOURS the `vendorId` filters, so these
 * tests fail if a query forgets to scope by vendor, rather than just asserting call shapes.
 */
const A = 'vendor-a';
const B = 'vendor-b';
const user = (vendorId: string, role = 'STAFF'): AuthUser => ({
  userId: `user-${vendorId}`,
  email: 'u@x.test',
  name: 'U',
  role: role as never,
  vendorId,
  customerId: null,
});

const baseCase = (over: Record<string, unknown> = {}) => ({
  id: 'case-b',
  vendorId: B,
  customerId: 'cust-b',
  productId: 'prod-b',
  driverId: 'driver-b',
  caseType: DamageCaseType.DAMAGE,
  status: DamageCaseStatus.UNDER_REVIEW,
  version: 3,
  bottleCount: 2,
  photoKeys: ['photo-1'],
  chargeAmount: null,
  ...over,
});

function makeFake(opts: {
  cases?: Record<string, unknown>[];
  customers?: { id: string; vendorId: string }[];
  products?: { id: string; vendorId: string }[];
  items?: { id: string; vendorId: string }[];
}) {
  const cases = opts.cases ?? [];
  const customers = opts.customers ?? [{ id: 'cust-b', vendorId: B }];
  const matches = (rows: any[], where: any) =>
    rows.find((r) => (where.id === undefined || r.id === where.id) && (where.vendorId === undefined || r.vendorId === where.vendorId)) ?? null;

  const db: any = {
    damageCase: {
      findFirst: jest.fn(async ({ where }: any) => matches(cases, where)),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-case', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...cases.find((c) => c.id === where.id), ...data })),
    },
    customer: {
      findFirst: jest.fn(async ({ where }: any) => matches(customers, where)),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    product: { findFirst: jest.fn(async ({ where }: any) => matches(opts.products ?? [{ id: 'prod-b', vendorId: B }], where)) },
    dailySheetItem: {
      findFirst: jest.fn(async ({ where }: any) =>
        (opts.items ?? []).find((i) => i.id === where.id && i.vendorId === where.dailySheet?.vendorId) ?? null,
      ),
    },
    bottleWallet: { findUnique: jest.fn(async () => ({ balance: 50 })), update: jest.fn(async () => ({})) },
    transaction: { create: jest.fn(async () => ({ id: 'tx-1' })) },
    damageCaseAuditLog: { create: jest.fn(async () => ({})) },
    user: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(db));
  return db;
}

const build = (db: unknown) =>
  new DamageCaseService(
    db as never,
    {} as never,
    { createMany: jest.fn(), create: jest.fn() } as never,
    { sendToVendorUsers: jest.fn(async () => undefined), sendToCustomer: jest.fn(async () => undefined) } as never,
  );

const expectNoMoneyOrWalletMoved = (db: any) => {
  expect(db.customer.update).not.toHaveBeenCalled();
  expect(db.bottleWallet.update).not.toHaveBeenCalled();
  expect(db.transaction.create).not.toHaveBeenCalled();
  expect(db.damageCase.update).not.toHaveBeenCalled();
};

describe('DamageCaseService — cross-tenant mutations are impossible', () => {
  const foreignCase = baseCase(); // owned by vendor B

  it('vendor A cannot CHARGE vendor B\'s case — B\'s customer balance is untouched', async () => {
    const db = makeFake({ cases: [foreignCase] });
    await expect(
      build(db).charge(user(A), 'case-b', { chargeAmount: 500, version: 3, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expectNoMoneyOrWalletMoved(db);
  });

  it('vendor A cannot WAIVE vendor B\'s case', async () => {
    const db = makeFake({ cases: [foreignCase] });
    await expect(
      build(db).waive(user(A), 'case-b', { version: 3, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expectNoMoneyOrWalletMoved(db);
  });

  it('vendor A cannot REVIEW vendor B\'s case', async () => {
    const db = makeFake({ cases: [baseCase({ status: DamageCaseStatus.REPORTED })] });
    await expect(build(db).review(user(A), 'case-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.damageCase.update).not.toHaveBeenCalled();
  });

  it('vendor A cannot UPDATE vendor B\'s case', async () => {
    const db = makeFake({ cases: [baseCase({ status: DamageCaseStatus.REPORTED })] });
    await expect(build(db).update(user(A), 'case-b', { bottleCount: 9, version: 3 } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.damageCase.update).not.toHaveBeenCalled();
  });

  it('vendor A cannot REVERSE vendor B\'s charged case', async () => {
    const db = makeFake({ cases: [baseCase({ status: DamageCaseStatus.CHARGED, chargeAmount: 100 })] });
    await expect(build(db).reverse(user(A), 'case-b', { version: 3 })).rejects.toBeInstanceOf(NotFoundException);
    expectNoMoneyOrWalletMoved(db);
  });

  it('every lookup is vendor-scoped (the query itself carries the caller\'s vendorId)', async () => {
    const db = makeFake({ cases: [foreignCase] });
    await build(db).review(user(A), 'case-b').catch(() => undefined);
    await build(db).charge(user(A), 'case-b', { chargeAmount: 1, version: 3 } as never).catch(() => undefined);
    for (const [arg] of db.damageCase.findFirst.mock.calls) expect(arg.where.vendorId).toBe(A);
  });
});

describe('DamageCaseService — the owning vendor is not over-blocked', () => {
  it('vendor B can review and charge its own case; the customer balance moves', async () => {
    const db = makeFake({ cases: [baseCase({ status: DamageCaseStatus.REPORTED }), baseCase({ id: 'case-b2' })] });
    const svc = build(db);

    await expect(svc.review(user(B), 'case-b')).resolves.toMatchObject({ status: DamageCaseStatus.UNDER_REVIEW });

    await svc.charge(user(B), 'case-b2', { chargeAmount: 500, version: 3, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never);
    expect(db.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cust-b' }, data: { financialBalance: { increment: 500 } } }),
    );
    expect(db.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ vendorId: B, customerId: 'cust-b' }) }),
    );
  });
});

describe('DamageCaseService — legacy rows pointing at another vendor\'s customer', () => {
  it('charge refuses to touch a customer outside the case\'s own vendor', async () => {
    // Row written before report() validated its inputs: case belongs to B but references A's customer.
    const db = makeFake({
      cases: [baseCase({ customerId: 'cust-a' })],
      customers: [{ id: 'cust-a', vendorId: A }],
    });
    await expect(
      build(db).charge(user(B), 'case-b', { chargeAmount: 500, version: 3, writeOffCategory: 'CUSTOMER_NEGLIGENCE' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expectNoMoneyOrWalletMoved(db);
  });
});

describe('DamageCaseService.report — referenced entities must belong to the reporter\'s vendor', () => {
  const dto = (over: Record<string, unknown> = {}) => ({
    customerId: 'cust-b',
    productId: 'prod-b',
    bottleCount: 1,
    photoKeys: [],
    ...over,
  });

  it('rejects a customer that belongs to another vendor — nothing is created', async () => {
    const db = makeFake({});
    await expect(build(db).report(user(A), dto() as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.damageCase.create).not.toHaveBeenCalled();
  });

  it('rejects a product that belongs to another vendor', async () => {
    const db = makeFake({ customers: [{ id: 'cust-b', vendorId: A }] }); // customer is A's, product is B's
    await expect(build(db).report(user(A), dto() as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.damageCase.create).not.toHaveBeenCalled();
  });

  it('rejects a delivery item that belongs to another vendor', async () => {
    const db = makeFake({
      customers: [{ id: 'cust-b', vendorId: A }],
      products: [{ id: 'prod-b', vendorId: A }],
      items: [{ id: 'item-b', vendorId: B }],
    });
    await expect(build(db).report(user(A), dto({ dailySheetItemId: 'item-b' }) as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.damageCase.create).not.toHaveBeenCalled();
  });

  it('creates the case when everything belongs to the reporter\'s vendor', async () => {
    const db = makeFake({
      customers: [{ id: 'cust-b', vendorId: A }],
      products: [{ id: 'prod-b', vendorId: A }],
      items: [{ id: 'item-a', vendorId: A }],
    });
    const created = await build(db).report(user(A, 'DRIVER'), dto({ dailySheetItemId: 'item-a' }) as never);
    expect(db.damageCase.create).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({ vendorId: A, customerId: 'cust-b', dailySheetItemId: 'item-a' });
  });
});
