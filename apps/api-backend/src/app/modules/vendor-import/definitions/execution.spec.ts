import { customersOpeningDefinition as def, type NormalizedCustomer } from './customers-opening.definition';
import { revertCustomerRows } from './customers-opening.revert';
import type { ExecOutcome } from './import-definition';

/** Minimal in-memory Prisma double — just the calls the executor / revert make. */
function fakePrisma(opts: { existingCodes?: string[]; failCreateWith?: { code: string }[] } = {}) {
  const state = {
    customers: [] as Record<string, unknown>[],
    wallets: [] as Record<string, unknown>[],
    prices: [] as Record<string, unknown>[],
    codes: new Set(opts.existingCodes ?? []),
    createFailures: [...(opts.failCreateWith ?? [])],
  };
  const tx = {
    customer: {
      findUnique: async ({ where }: { where: { vendorId_customerCode: { customerCode: string } } }) =>
        state.codes.has(where.vendorId_customerCode.customerCode) ? { id: 'x' } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const fail = state.createFailures.shift();
        if (fail) throw Object.assign(new Error('boom'), fail);
        const c = { id: `cust-${state.customers.length + 1}`, ...data };
        state.customers.push(c);
        state.codes.add(data['customerCode'] as string);
        return c;
      },
    },
    customerDeliverySchedule: { createMany: async () => undefined },
    product: { findMany: async () => [] },
    bottleWallet: { create: async ({ data }: { data: Record<string, unknown> }) => void state.wallets.push(data) },
    customerProductPrice: { upsert: async ({ create }: { create: Record<string, unknown> }) => void state.prices.push(create) },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { prisma: prisma as never, state };
}

const baseRow = (over: Partial<NormalizedCustomer> = {}): { rowNumber: number; normalized: NormalizedCustomer } => ({
  rowNumber: 2,
  normalized: {
    customerCode: 'C1', name: 'Ali', phoneNumber: '923001234567', hasPhone: true, address: 'H1', floor: null, nearbyLandmark: null,
    paymentType: 'MONTHLY', isActive: true, rate: 250, openingBalance: 1500, openingBottles: 3, ...over,
  },
});
const options = { productId: 'p1', balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: '2026-10-01', codeStrategy: 'USE_FILE_CODES', defaultPaymentType: 'CASH', areaIntoAddress: true } as const;
const exec = () => ({ activeProductIds: ['p1', 'p2'], basePriceByProduct: new Map([['p1', 240]]), reservedCodes: new Set<string>(), nextNumber: 10 });

describe('customers-opening executeRow', () => {
  it('creates the customer, sets balances directly, wallets for every product, rate override — and records inside the tx', async () => {
    const { prisma, state } = fakePrisma();
    const recorded: ExecOutcome[] = [];
    const out = await def.executeRow(prisma, 'v1', baseRow(), exec(), options, async (_tx, o) => void recorded.push(o));
    expect(out.result).toBe('CREATED');
    expect(recorded).toHaveLength(1); // record() ran (inside the transaction) exactly once
    expect(state.customers[0]).toMatchObject({ customerCode: 'C1', vendorId: 'v1', financialBalance: 1500, paymentType: 'MONTHLY' });
    expect(state.wallets).toEqual([
      { customerId: 'cust-1', productId: 'p1', balance: 3 },
      { customerId: 'cust-1', productId: 'p2', balance: 0 },
    ]);
    expect(state.prices).toEqual([{ customerId: 'cust-1', productId: 'p1', customPrice: 250 }]);
    expect(out.appliedSnapshot).toMatchObject({ financialBalance: 1500, productId: 'p1', walletBalance: 3, customPrice: 250 });
  });

  it('stores no custom price when the rate equals the product price, but keeps a genuine 0 rate', async () => {
    const same = fakePrisma();
    await def.executeRow(same.prisma, 'v1', baseRow({ rate: 240 }), exec(), options, async () => undefined);
    expect(same.state.prices).toHaveLength(0);
    const zero = fakePrisma();
    await def.executeRow(zero.prisma, 'v1', baseRow({ rate: 0 }), exec(), options, async () => undefined);
    expect(zero.state.prices).toEqual([{ customerId: 'cust-1', productId: 'p1', customPrice: 0 }]);
  });

  it('skips (does not touch) a code that appeared since the plan was built', async () => {
    const { prisma, state } = fakePrisma({ existingCodes: ['C1'] });
    const record = jest.fn();
    const out = await def.executeRow(prisma, 'v1', baseRow(), exec(), options, record);
    expect(out).toMatchObject({ result: 'SKIPPED', resultCode: 'CODE_ALREADY_EXISTS' });
    expect(state.customers).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('allocates generated codes, skipping codes the file reserves', async () => {
    const { prisma, state } = fakePrisma();
    const e = exec();
    e.reservedCodes.add('L10');
    await def.executeRow(prisma, 'v1', baseRow({ customerCode: null }), e, options, async () => undefined);
    expect(state.customers[0]).toMatchObject({ customerCode: 'L11' });
  });

  it('retries a generated code that races (P2002) but fails a file-supplied one as CODE_CONFLICT', async () => {
    const gen = fakePrisma({ failCreateWith: [{ code: 'P2002' }] });
    const g = await def.executeRow(gen.prisma, 'v1', baseRow({ customerCode: null }), exec(), options, async () => undefined);
    expect(g.result).toBe('CREATED');
    expect(gen.state.customers[0]).toMatchObject({ customerCode: 'L11' });

    const file = fakePrisma({ failCreateWith: [{ code: 'P2002' }] });
    const f = await def.executeRow(file.prisma, 'v1', baseRow(), exec(), options, async () => undefined);
    expect(f).toMatchObject({ result: 'FAILED', resultCode: 'CODE_CONFLICT' });
  });

  it('an unexpected DB error fails only that row, with a customer-safe message', async () => {
    const { prisma } = fakePrisma({ failCreateWith: [{ code: 'P1001' }] });
    const out = await def.executeRow(prisma, 'v1', baseRow(), exec(), options, async () => undefined);
    expect(out).toMatchObject({ result: 'FAILED', resultCode: 'DB_ERROR' });
    expect(out.resultMessage).not.toMatch(/boom|P1001/);
  });
});

describe('revertCustomerRows', () => {
  const snap = { financialBalance: 1500, productId: 'p1', walletBalance: 3 };
  function revertPrisma(customers: Record<string, unknown>[], activity: Record<string, string[]> = {}) {
    const deleted: string[] = [];
    const groupBy = (delegate: string) => async ({ by }: { by: string[] }) =>
      (activity[delegate] ?? []).map((id) => ({ [by[0]]: id }));
    const tx = {
      customerDeliverySchedule: { deleteMany: async () => undefined },
      bottleWallet: { deleteMany: async () => undefined },
      customerProductPrice: { deleteMany: async () => undefined },
      customer: { delete: async ({ where }: { where: { id: string } }) => void deleted.push(where.id) },
    };
    const names = ['transaction', 'dailySheetItem', 'deliveryItemMoveLog', 'customerOrder', 'customerTicket', 'paymentRequest', 'damageCase', 'conversation', 'customerDeposit', 'customerFinancialAdjustment', 'customerFlag', 'deliveryRepricingBatch', 'staffLedgerEntry'];
    const prisma: Record<string, unknown> = {
      customer: { findMany: async () => customers },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    for (const n of names) prisma[n] = { groupBy: groupBy(n) };
    return { prisma: prisma as never, deleted };
  }
  const cust = (id: string, over: Record<string, unknown> = {}) => ({ id, financialBalance: 1500, userId: null, wallets: [{ productId: 'p1', balance: 3 }], ...over });
  const rows = (...ids: string[]) => ids.map((id) => ({ rowId: `r-${id}`, entityId: id, appliedSnapshot: snap }));

  it('reverts an untouched customer', async () => {
    const { prisma, deleted } = revertPrisma([cust('a')]);
    const out = await revertCustomerRows(prisma, 'v1', rows('a'), false);
    expect(out).toEqual([{ rowId: 'r-a', result: 'REVERTED' }]);
    expect(deleted).toEqual(['a']);
  });
  it('refuses customers with activity, a changed balance, or a portal login — and says why', async () => {
    const { prisma, deleted } = revertPrisma(
      [cust('act'), cust('bal', { financialBalance: 1000 }), cust('portal', { userId: 'u1' }), cust('wal', { wallets: [{ productId: 'p1', balance: 2 }] }), cust('ok')],
      { dailySheetItem: ['act'] },
    );
    const out = await revertCustomerRows(prisma, 'v1', rows('act', 'bal', 'portal', 'wal', 'ok', 'gone'), false);
    expect(out.map((o) => [o.rowId, o.resultCode ?? o.result])).toEqual([
      ['r-act', 'HAS_ACTIVITY'],
      ['r-bal', 'BALANCE_CHANGED'],
      ['r-portal', 'PORTAL_LINKED'],
      ['r-wal', 'BALANCE_CHANGED'],
      ['r-ok', 'REVERTED'],
      ['r-gone', 'ALREADY_GONE'],
    ]);
    expect(deleted).toEqual(['ok']);
  });
  it('dry-run reports the same decisions but deletes nothing', async () => {
    const { prisma, deleted } = revertPrisma([cust('a')]);
    const out = await revertCustomerRows(prisma, 'v1', rows('a'), true);
    expect(out[0].result).toBe('REVERTED');
    expect(deleted).toEqual([]);
  });
});
