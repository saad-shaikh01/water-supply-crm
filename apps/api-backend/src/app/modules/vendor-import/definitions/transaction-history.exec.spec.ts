import { ConflictException } from '@nestjs/common';
import { ImportedTransactionGuard } from '../../transaction/imported-transaction.guard';
import { revertHistoryRows } from './transaction-history.revert';
import { transactionHistoryDefinition as def, type HistoryOptions, type NormalizedVoucher } from './transaction-history.definition';

const OPTS: HistoryOptions = { cutoverDate: '2025-12-31', reportingMode: 'STATEMENT_ONLY', productId: 'p1', dateOrder: 'MDY', reportsAcknowledged: false };

const voucher = (over: Partial<NormalizedVoucher>): NormalizedVoucher => ({
  valid: true,
  customerCode: 'C1',
  voucher: '1',
  date: '2025-03-01',
  filled: 2,
  empty: 1,
  charge: 400,
  paid: 150,
  outstandingAfter: 250,
  bottleBalanceAfter: 5,
  reconcile: { finalOutstanding: 250, finalBottles: 5 },
  ...over,
});

function fakePrisma(opts: { balance?: number; postMoney?: number; taken?: string[]; customer?: null } = {}) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    customer: {
      findUnique: jest.fn(async () => (opts.customer === null ? null : { id: 'cust-1', financialBalance: opts.balance ?? 250, wallets: [{ balance: 5 }] })),
    },
    importRow: { findMany: jest.fn(async () => (opts.taken ?? []).map((dedupeKey) => ({ dedupeKey }))) },
    transaction: {
      aggregate: jest.fn(async () => ({ _sum: { amount: opts.postMoney ?? 0, bottleCount: 0 } })),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) };
  return { prisma, tx, created };
}

const rows = (list: { n: NormalizedVoucher; key?: string }[]) => list.map((r, i) => ({ rowId: `r${i + 1}`, rowNumber: i + 2, normalized: r.n, dedupeKey: r.key ?? `k${i + 1}` }));

describe('transactionHistoryDefinition.executeGroup', () => {
  it('posts a charge and a payment row per voucher as HISTORICAL, records them in the SAME transaction, and never touches balances', async () => {
    const { prisma, tx, created } = fakePrisma();
    const recordMany = jest.fn(async (..._a: unknown[]) => undefined);
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }, { n: voucher({ date: '2025-03-01', voucher: '2', filled: 0, empty: 0, charge: 0, paid: 50 }) }]), { batchId: 'b1' }, OPTS, recordMany);

    expect(out?.every((o) => o.outcome.result === 'CREATED')).toBe(true);
    expect(created.map((c) => [c.type, c.amount, c.description])).toEqual([
      ['HISTORICAL', 400, 'Delivered 2, Received 1'],
      ['HISTORICAL', -150, 'Payment received'],
      ['HISTORICAL', -50, 'Payment received'], // second voucher: payment only, no empty charge row
    ]);
    expect(created.every((c) => c.vendorId === 'v1' && c.customerId === 'cust-1')).toBe(true);
    expect(recordMany).toHaveBeenCalledTimes(1);
    expect(recordMany.mock.calls[0][0]).toBe(tx); // the group's own tx client
    // the invariants the whole feature rests on: no balance write, no sheet, no wallet write
    expect(Object.keys(tx.customer)).toEqual(['findUnique']);
    expect(Object.keys(tx)).not.toContain('bottleWallet');
  });

  it('reports mode writes ordinary DELIVERY / PAYMENT rows', async () => {
    const { prisma, created } = fakePrisma();
    await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }]), { batchId: 'b1' }, { ...OPTS, reportingMode: 'COUNT_IN_REPORTS' }, jest.fn(async () => undefined));
    expect(created.map((c) => c.type)).toEqual(['DELIVERY', 'PAYMENT']);
  });

  it('stamps createdAt at 12:00 PKT with a per-day order offset (charge before payment)', async () => {
    const { prisma, created } = fakePrisma();
    await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }, { n: voucher({ voucher: '2', paid: 0, outstandingAfter: 250 }) }]), { batchId: 'b1' }, OPTS, jest.fn(async () => undefined));
    const t = created.map((c) => (c.createdAt as Date).toISOString());
    expect(t[0]).toBe('2025-03-01T07:00:00.000Z'); // 1st charge
    expect(t[1]).toBe('2025-03-01T07:00:01.000Z'); // its payment
    expect(t[2]).toBe('2025-03-01T07:00:02.000Z'); // 2nd voucher the same day sorts after
  });

  it('skips the whole group (BALANCE_CHANGED) when the balance moved since the preview', async () => {
    const { prisma, created } = fakePrisma({ balance: 999 });
    const recordMany = jest.fn(async () => undefined);
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }]), { batchId: 'b1' }, OPTS, recordMany);
    expect(out?.[0].outcome).toMatchObject({ result: 'SKIPPED', resultCode: 'BALANCE_CHANGED' });
    expect(created).toHaveLength(0);
    expect(recordMany).not.toHaveBeenCalled();
  });

  it('live activity after the cutover is not a drift (balance at cutover is what is compared)', async () => {
    const { prisma, created } = fakePrisma({ balance: 350, postMoney: 100 });
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }]), { batchId: 'b1' }, OPTS, jest.fn(async () => undefined));
    expect(out?.[0].outcome.result).toBe('CREATED');
    expect(created.length).toBeGreaterThan(0);
  });

  it('re-checks idempotency at write time: a voucher another batch already imported is skipped, the rest is posted', async () => {
    const { prisma, created } = fakePrisma({ taken: ['k1'] });
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }, { n: voucher({ voucher: '2', date: '2025-03-02', paid: 0, filled: 1, empty: 1, charge: 200 }) }]), { batchId: 'b1' }, OPTS, jest.fn(async () => undefined));
    expect(out?.find((o) => o.rowId === 'r1')?.outcome).toMatchObject({ result: 'SKIPPED', resultCode: 'ALREADY_IMPORTED' });
    expect(out?.find((o) => o.rowId === 'r2')?.outcome.result).toBe('CREATED');
    expect(created).toHaveLength(1);
  });

  it('a customer that vanished is SKIPPED, not FAILED', async () => {
    const { prisma } = fakePrisma({ customer: null });
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }]), { batchId: 'b1' }, OPTS, jest.fn(async () => undefined));
    expect(out?.[0].outcome).toMatchObject({ result: 'SKIPPED', resultCode: 'CUSTOMER_NOT_FOUND' });
  });

  it('a database error fails the group as a unit (all rows FAILED, cause kept for the log only)', async () => {
    const prisma = { $transaction: jest.fn(async () => { throw Object.assign(new Error('boom'), { code: 'P2028' }); }) };
    const out = await def.executeGroup?.(prisma as never, 'v1', rows([{ n: voucher({}) }, { n: voucher({ voucher: '2' }) }]), { batchId: 'b1' }, OPTS, jest.fn(async () => undefined));
    expect(out?.every((o) => o.outcome.result === 'FAILED' && o.outcome.resultCode === 'DB_ERROR')).toBe(true);
    expect(JSON.stringify(out?.map((o) => o.outcome.resultMessage))).not.toMatch(/boom|P2028/); // customer-safe message
  });
});

describe('revertHistoryRows', () => {
  const input = [
    { rowId: 'r1', entityId: 't1', appliedSnapshot: { txIds: ['t1', 't2'] } },
    { rowId: 'r2', entityId: 't3', appliedSnapshot: { txIds: ['t3'] } },
    { rowId: 'r3', entityId: 't4', appliedSnapshot: { txIds: ['t4'] } },
    { rowId: 'r4', entityId: 't5', appliedSnapshot: { txIds: ['t5'] } },
  ];
  const stored = [
    { id: 't1', lastEditedAt: null, dailySheetItemId: null, paymentRequestId: null, adjustmentId: null },
    { id: 't2', lastEditedAt: null, dailySheetItemId: null, paymentRequestId: null, adjustmentId: null },
    { id: 't3', lastEditedAt: new Date(), dailySheetItemId: null, paymentRequestId: null, adjustmentId: null }, // edited later
    // t4 no longer exists
    { id: 't5', lastEditedAt: null, dailySheetItemId: 'item-9', paymentRequestId: null, adjustmentId: null }, // tied to a delivery item
  ];
  const prisma = () => ({ transaction: { findMany: jest.fn(async () => stored), deleteMany: jest.fn(async () => ({ count: 2 })) } });

  it('deletes only untouched rows by the ids recorded in the snapshot, vendor-scoped, and explains the rest', async () => {
    const p = prisma();
    const out = await revertHistoryRows(p as never, 'v1', input, false);
    expect(out.map((o) => [o.rowId, o.result, o.resultCode])).toEqual([
      ['r1', 'REVERTED', undefined],
      ['r2', 'REVERT_SKIPPED', 'EDITED'],
      ['r3', 'REVERT_SKIPPED', 'ALREADY_GONE'],
      ['r4', 'REVERT_SKIPPED', 'EDITED'],
    ]);
    expect(p.transaction.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['t1', 't2'] }, vendorId: 'v1' } });
  });

  it('dry run deletes nothing', async () => {
    const p = prisma();
    const out = await revertHistoryRows(p as never, 'v1', input, true);
    expect(out[0].result).toBe('REVERTED');
    expect(p.transaction.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ImportedTransactionGuard', () => {
  it('refuses to edit/delete a payment written by an import (vendor-scoped lookup)', async () => {
    const findFirst = jest.fn(async () => ({ id: 'row-1' }));
    const guard = new ImportedTransactionGuard({ importRow: { findFirst } } as never);
    await expect(guard.assertNotImported('v1', 'tx-1')).rejects.toBeInstanceOf(ConflictException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ result: 'CREATED', batch: { vendorId: 'v1' }, appliedSnapshot: { path: ['txIds'], array_contains: 'tx-1' } }) }));
  });

  it('lets an ordinary payment through', async () => {
    const guard = new ImportedTransactionGuard({ importRow: { findFirst: jest.fn(async () => null) } } as never);
    await expect(guard.assertNotImported('v1', 'tx-2')).resolves.toBeUndefined();
  });
});
