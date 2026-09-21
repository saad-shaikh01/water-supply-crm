import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerFinancialAdjustmentService } from './customer-financial-adjustment.service';
import { CreateCustomerFinancialAdjustmentDto } from './dto/create-customer-financial-adjustment.dto';

const VENDOR_ID = 'vendor-1';
const CUSTOMER_ID = 'customer-1';
const USER: AuthUser = {
  userId: 'user-1',
  email: 'staff@example.com',
  name: 'Alice Staff',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};

const P = (a: string) => `customer_financial_adjustments:${a}`;
const CHARGE_KINDS = ['SERVICE_FEE', 'PENALTY', 'OTHER_CHARGE'] as const;
const CREDIT_KINDS = ['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CREDIT'] as const;

/**
 * Prisma mock with REAL commit/rollback semantics: every write inside `$transaction`
 * lands in `pending`; it moves to `committed` only if the callback resolves, and is
 * discarded if it throws. A write made on the plain client (outside a transaction) is
 * recorded in `outsideTx` — the tests assert that stays empty, i.e. all four writes of
 * a posting really are one atomic unit.
 */
function buildHarness(opts: { balanceBefore?: number } = {}) {
  let balance = opts.balanceBefore ?? 1000;
  let inTx = false;
  let pending: string[] = [];
  const committed: string[] = [];
  const outsideTx: string[] = [];
  const writeLog = (name: string) => (inTx ? pending.push(name) : outsideTx.push(name));

  const db: any = {
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
      findUnique: jest.fn().mockImplementation(async () => ({ financialBalance: balance })),
      update: jest.fn().mockImplementation(async (args: any) => {
        writeLog('customer.update');
        balance += args.data.financialBalance.increment;
        return { financialBalance: balance };
      }),
    },
    customerFinancialAdjustment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (args: any) => {
        writeLog('adjustment.create');
        return { id: 'adj-1', status: 'POSTED', ...args.data };
      }),
    },
    transaction: {
      create: jest.fn().mockImplementation(async (args: any) => {
        writeLog('transaction.create');
        return { id: 'txn-1', ...args.data };
      }),
    },
    auditLog: {
      create: jest.fn().mockImplementation(async (args: any) => {
        writeLog('auditLog.create');
        return { id: 'audit-1', ...args.data };
      }),
    },
  };
  db.$transaction = jest.fn().mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
    inTx = true;
    pending = [];
    try {
      const result = await fn(db);
      committed.push(...pending);
      return result;
    } finally {
      inTx = false;
      pending = [];
    }
  });

  return { db, committed, outsideTx, getBalance: () => balance };
}

function buildService(granted: string[], harness = buildHarness()) {
  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
  };
  const permissions = {
    can: jest.fn().mockImplementation(async (_userId: string, perm: string) => granted.includes(perm)),
  };
  const service = new CustomerFinancialAdjustmentService(harness.db, cache as any, permissions as any);
  return { service, cache, permissions, ...harness };
}

let keySeq = 0;
const dto = (over: Partial<CreateCustomerFinancialAdjustmentDto> = {}): CreateCustomerFinancialAdjustmentDto =>
  ({
    customerId: CUSTOMER_ID,
    kind: 'PENALTY',
    amount: 500,
    title: 'Late payment penalty',
    idempotencyKey: `key-${++keySeq}-abcdefgh`,
    ...over,
  }) as CreateCustomerFinancialAdjustmentDto;

const ALL = [P('create'), P('create_credit')];
const CREDIT_NOTE = { internalNote: 'Customer complained about delayed delivery' };

describe('CustomerFinancialAdjustmentService.create', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-09-20T09:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── Balance delta + ledger row ────────────────────────────────────────────────
  describe('balance delta and ledger row', () => {
    it.each([
      ...CHARGE_KINDS.map((k) => [k, 'CHARGE', +500, {}] as const),
      ...CREDIT_KINDS.map((k) => [k, 'CREDIT', -500, CREDIT_NOTE] as const),
    ])('%s (%s) moves the balance by %p and posts one signed ADJUSTMENT row', async (kind, direction, delta, extra) => {
      const { service, db, getBalance } = buildService(ALL, buildHarness({ balanceBefore: 1000 }));

      const result = await service.create(USER, dto({ kind, amount: 500, ...extra }));

      expect(db.customer.update).toHaveBeenCalledTimes(1);
      expect(db.customer.update.mock.calls[0][0]).toMatchObject({
        where: { id: CUSTOMER_ID },
        data: { financialBalance: { increment: delta } },
      });
      expect(getBalance()).toBe(1000 + delta);
      expect(result.customerBalance).toBe(1000 + delta);

      // The document keeps the POSITIVE amount + a direction; only the ledger row is signed.
      const doc = db.customerFinancialAdjustment.create.mock.calls[0][0].data;
      expect(doc).toMatchObject({ vendorId: VENDOR_ID, customerId: CUSTOMER_ID, kind, direction, amount: 500, createdById: USER.userId });

      const txn = db.transaction.create.mock.calls[0][0].data;
      expect(txn).toMatchObject({
        type: TransactionType.ADJUSTMENT,
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        adjustmentId: 'adj-1',
        amount: delta,
      });
      expect(result.idempotentReplay).toBe(false);
      expect(result.adjustment.id).toBe('adj-1');
      expect(result.transaction.amount).toBe(delta);
    });

    it('the direction is fixed by the kind — a caller-supplied `direction` can never turn a penalty into a credit', async () => {
      const { service, db } = buildService(ALL, buildHarness({ balanceBefore: 1000 }));
      await service.create(USER, { ...dto({ kind: 'PENALTY', amount: 500 }), direction: 'CREDIT' } as any);

      expect(db.customerFinancialAdjustment.create.mock.calls[0][0].data.direction).toBe('CHARGE');
      expect(db.customer.update.mock.calls[0][0].data.financialBalance.increment).toBe(500);
      expect(db.transaction.create.mock.calls[0][0].data.amount).toBe(500);
    });

    it('posts money only: no product, no bottle count on the ledger row', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto());
      const txn = db.transaction.create.mock.calls[0][0].data;
      expect('productId' in txn).toBe(false);
      expect('bottleCount' in txn).toBe(false);
    });

    it('stores a 2-decimal amount exactly (no float drift)', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto({ amount: 100.1 }));
      expect(db.customer.update.mock.calls[0][0].data.financialBalance.increment).toBe(100.1);
      expect(db.customerFinancialAdjustment.create.mock.calls[0][0].data.amount).toBe(100.1);
    });

    it('trims the title and uses it as the customer-facing ledger text', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto({ title: '  Installation charge  ' }));
      expect(db.customerFinancialAdjustment.create.mock.calls[0][0].data.title).toBe('Installation charge');
      expect(db.transaction.create.mock.calls[0][0].data.description).toBe('Installation charge');
    });

    it('never puts the internal note (or any staff-only field) on the ledger row — the portal returns raw Transaction rows', async () => {
      const { service, db } = buildService(ALL);
      const note = 'SECRET: owner said waive next time';
      await service.create(USER, dto({ kind: 'DISCOUNT', internalNote: note, referenceNo: 'REF-77' }));

      const doc = db.customerFinancialAdjustment.create.mock.calls[0][0].data;
      expect(doc.internalNote).toBe(note); // kept on the document
      const txnJson = JSON.stringify(db.transaction.create.mock.calls[0][0].data);
      expect(txnJson).not.toContain('SECRET');
      expect(txnJson).not.toContain('REF-77');
    });

    it('resolves visibility from the kind policy (all 2A kinds are ITEMIZED)', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto());
      expect(db.customerFinancialAdjustment.create.mock.calls[0][0].data.customerVisibility).toBe('ITEMIZED');
    });
  });

  // ── Effective date ────────────────────────────────────────────────────────────
  describe('effective date', () => {
    it('defaults to now and uses the SAME instant for the document and the ledger createdAt', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto());
      const docDate = db.customerFinancialAdjustment.create.mock.calls[0][0].data.effectiveDate;
      const txnDate = db.transaction.create.mock.calls[0][0].data.createdAt;
      expect(docDate).toEqual(new Date('2026-09-20T09:00:00.000Z'));
      expect(txnDate).toEqual(docDate);
    });

    it('backdates within the current month to that day\'s PKT midnight', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto({ effectiveDate: '2026-09-05' }));
      expect(db.transaction.create.mock.calls[0][0].data.createdAt).toEqual(new Date('2026-09-04T19:00:00.000Z'));
    });

    it.each([
      ['a previous month', '2026-08-31', /current month/],
      ['the future', '2026-09-21', /future/],
    ])('rejects %s and posts nothing', async (_label, date, message) => {
      const { service, committed } = buildService(ALL);
      await expect(service.create(USER, dto({ effectiveDate: date }))).rejects.toThrow(message);
      expect(committed).toEqual([]);
    });
  });

  // ── Atomicity ─────────────────────────────────────────────────────────────────
  describe('atomicity: adjustment + ledger row + balance + audit succeed or fail together', () => {
    it('commits exactly the four writes, all inside ONE transaction', async () => {
      const { service, db, committed, outsideTx } = buildService(ALL);
      await service.create(USER, dto());

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(outsideTx).toEqual([]);
      expect([...committed].sort()).toEqual(
        ['adjustment.create', 'auditLog.create', 'customer.update', 'transaction.create'],
      );
    });

    it.each([
      ['adjustment.create', (db: any) => db.customerFinancialAdjustment.create],
      ['transaction.create', (db: any) => db.transaction.create],
      ['customer.update', (db: any) => db.customer.update],
      ['auditLog.create', (db: any) => db.auditLog.create],
    ])('a failure in %s rolls everything back and skips the cache fan-out', async (_name, pick) => {
      const { service, db, committed, cache } = buildService(ALL);
      pick(db).mockImplementationOnce(async () => {
        throw new Error('boom');
      });

      await expect(service.create(USER, dto())).rejects.toThrow('boom');

      expect(committed).toEqual([]);
      expect(cache.invalidateVendorEntity).not.toHaveBeenCalled();
      expect(cache.invalidateOverview).not.toHaveBeenCalled();
    });

    it('writes the audit row INSIDE the transaction with the full trail', async () => {
      const { service, db } = buildService(ALL, buildHarness({ balanceBefore: 2000 }));
      await service.create(USER, dto({ kind: 'GOODWILL_CREDIT', amount: 300, ...CREDIT_NOTE, title: 'Goodwill' }));

      expect(db.auditLog.create).toHaveBeenCalledTimes(1);
      const row = db.auditLog.create.mock.calls[0][0].data;
      expect(row).toMatchObject({
        vendorId: VENDOR_ID,
        userId: USER.userId,
        userName: 'Alice Staff',
        action: 'CREATE',
        entity: 'CustomerFinancialAdjustment',
        entityId: 'adj-1',
      });
      expect(row.changes.before).toEqual({ financialBalance: 2000 });
      expect(row.changes.after).toMatchObject({
        kind: 'GOODWILL_CREDIT',
        direction: 'CREDIT',
        amount: 300,
        signedAmount: -300,
        transactionId: 'txn-1',
        financialBalance: 1700,
      });
      expect(row.changes.reason).toBe(CREDIT_NOTE.internalNote);
    });
  });

  // ── Per-kind permission ───────────────────────────────────────────────────────
  describe('per-kind permission', () => {
    it.each(CHARGE_KINDS)('%s requires customer_financial_adjustments:create', async (kind) => {
      const { service, permissions } = buildService([P('create')]);
      await service.create(USER, dto({ kind }));
      expect(permissions.can).toHaveBeenCalledWith(USER.userId, P('create'));
    });

    it.each(CREDIT_KINDS)('%s requires customer_financial_adjustments:create_credit', async (kind) => {
      const { service, permissions } = buildService([P('create_credit')]);
      await service.create(USER, dto({ kind, ...CREDIT_NOTE }));
      expect(permissions.can).toHaveBeenCalledWith(USER.userId, P('create_credit'));
    });

    it.each(CREDIT_KINDS)('a charge-only user (create) CANNOT post %s', async (kind) => {
      const { service, committed } = buildService([P('create')]);
      await expect(service.create(USER, dto({ kind, ...CREDIT_NOTE }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(committed).toEqual([]);
    });

    it.each(CHARGE_KINDS)('a credit-only user (create_credit) CANNOT post %s', async (kind) => {
      const { service, committed } = buildService([P('create_credit')]);
      await expect(service.create(USER, dto({ kind }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(committed).toEqual([]);
    });

    it.each([...CHARGE_KINDS, ...CREDIT_KINDS])('%s: a user holding no adjustment permission is refused', async (kind) => {
      const { service, committed } = buildService([P('view'), P('void'), 'customers:view']);
      await expect(service.create(USER, dto({ kind, ...CREDIT_NOTE }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(committed).toEqual([]);
    });

    it('checks permission BEFORE touching the DB (no customer probing, no idempotency lookup)', async () => {
      const { service, db } = buildService([]);
      await expect(service.create(USER, dto())).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.customer.findFirst).not.toHaveBeenCalled();
      expect(db.customerFinancialAdjustment.findFirst).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each(['WRITE_OFF', 'CORRECTION', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL', 'NOT_A_KIND'])(
      'kind %s is not enabled in this slice — refused even with every permission',
      async (kind) => {
        const { service, committed } = buildService([...ALL, P('transfer'), P('create_restricted'), P('void')]);
        await expect(service.create(USER, dto({ kind: kind as any, ...CREDIT_NOTE }))).rejects.toBeInstanceOf(BadRequestException);
        expect(committed).toEqual([]);
      },
    );
  });

  // ── Validation ────────────────────────────────────────────────────────────────
  describe('validation', () => {
    it.each([
      ['zero amount', { amount: 0 }],
      ['negative amount', { amount: -10 }],
      ['3 decimal places', { amount: 10.005 }],
      ['blank title', { title: '   ' }],
      ['missing idempotency key', { idempotencyKey: '' }],
      ['a credit without an internal note', { kind: 'DISCOUNT' as const }],
      ['a credit with a whitespace-only note', { kind: 'OTHER_CREDIT' as const, internalNote: '   ' }],
    ])('rejects %s and posts nothing', async (_label, over) => {
      const { service, committed, db } = buildService(ALL);
      await expect(service.create(USER, dto(over as any))).rejects.toBeInstanceOf(BadRequestException);
      expect(committed).toEqual([]);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('does NOT require an internal note for a charge', async () => {
      const { service } = buildService(ALL);
      await expect(service.create(USER, dto({ kind: 'SERVICE_FEE' }))).resolves.toBeDefined();
    });

    it('404s for an unknown customer and posts nothing', async () => {
      const h = buildHarness();
      h.db.customer.findFirst.mockResolvedValue(null);
      const { service, committed } = buildService(ALL, h);
      await expect(service.create(USER, dto())).rejects.toBeInstanceOf(NotFoundException);
      expect(committed).toEqual([]);
    });

    it('scopes the customer lookup to the caller\'s vendor (no cross-tenant posting)', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto());
      expect(db.customer.findFirst.mock.calls[0][0].where).toEqual({ id: CUSTOMER_ID, vendorId: VENDOR_ID });
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────────
  describe('idempotency', () => {
    it('scopes the key lookup to the vendor', async () => {
      const { service, db } = buildService(ALL);
      await service.create(USER, dto({ idempotencyKey: 'scoped-key-1234' }));
      expect(db.customerFinancialAdjustment.findFirst.mock.calls[0][0].where).toEqual({
        vendorId: VENDOR_ID,
        idempotencyKey: 'scoped-key-1234',
      });
    });

    it('a retry with the same key + same request posts NOTHING new and returns the original', async () => {
      const h = buildHarness({ balanceBefore: 1000 });
      const { service, db, cache, committed, getBalance } = buildService(ALL, h);
      const request = dto({ idempotencyKey: 'retry-key-1234' });

      const first = await service.create(USER, request);
      expect(first.idempotentReplay).toBe(false);
      expect(getBalance()).toBe(1500);

      // The second call finds the stored document (+ its ledger row) by key.
      db.customerFinancialAdjustment.findFirst.mockResolvedValueOnce({
        ...first.adjustment,
        transaction: first.transaction,
      });
      cache.invalidateVendorEntity.mockClear();

      const second = await service.create(USER, request);

      expect(second.idempotentReplay).toBe(true);
      expect(second.adjustment.id).toBe(first.adjustment.id);
      expect(second.transaction.id).toBe(first.transaction.id);
      expect(second.customerBalance).toBe(1500); // live balance, unchanged
      expect(getBalance()).toBe(1500); // NOT double-posted
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(committed).toHaveLength(4); // still only the first post's four writes
      expect(cache.invalidateVendorEntity).not.toHaveBeenCalled();
    });

    it.each([
      ['amount', { amount: 999 }],
      ['kind', { kind: 'SERVICE_FEE' as const }],
      ['title', { title: 'Something else' }],
      ['customer', { customerId: 'customer-2' }],
    ])('reusing a key with a different %s is a 409, not a silent drop', async (_label, over) => {
      const h = buildHarness();
      const { service, db, committed } = buildService(ALL, h);
      db.customerFinancialAdjustment.findFirst.mockResolvedValueOnce({
        id: 'adj-old',
        customerId: CUSTOMER_ID,
        kind: 'PENALTY',
        amount: 500,
        title: 'Late payment penalty',
        transaction: { id: 'txn-old', amount: 500 },
      });

      await expect(service.create(USER, dto(over as any))).rejects.toBeInstanceOf(ConflictException);
      expect(committed).toEqual([]);
    });

    const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

    it('two identical submits racing: the loser hits the unique key and replays the winner', async () => {
      const h = buildHarness();
      const { service, db, cache } = buildService(ALL, h);
      const request = dto({ idempotencyKey: 'race-key-12345' });

      // Pre-check sees nothing (both requests passed it) …
      db.customerFinancialAdjustment.findFirst.mockResolvedValueOnce(null);
      // … the insert loses the race …
      db.customerFinancialAdjustment.create.mockImplementationOnce(async () => {
        throw p2002();
      });
      // … and the re-read finds the winner.
      db.customerFinancialAdjustment.findFirst.mockResolvedValueOnce({
        id: 'adj-winner',
        customerId: CUSTOMER_ID,
        kind: 'PENALTY',
        amount: 500,
        title: 'Late payment penalty',
        transaction: { id: 'txn-winner', amount: 500 },
      });

      const result = await service.create(USER, request);

      expect(result.idempotentReplay).toBe(true);
      expect(result.adjustment.id).toBe('adj-winner');
      expect(cache.invalidateVendorEntity).not.toHaveBeenCalled();
    });

    it('a P2002 with no winner to replay is re-thrown, not swallowed', async () => {
      const { service, db } = buildService(ALL);
      db.customerFinancialAdjustment.create.mockImplementationOnce(async () => {
        throw p2002();
      });
      await expect(service.create(USER, dto())).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  // ── Cache ─────────────────────────────────────────────────────────────────────
  describe('cache invalidation', () => {
    it('runs once AFTER commit with the same fan-out as recordPayment', async () => {
      const { service, cache } = buildService(ALL);
      await service.create(USER, dto());
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(VENDOR_ID, expect.anything());
      expect(cache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(cache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
      expect(cache.invalidateCustomerWallets).toHaveBeenCalledWith(VENDOR_ID, CUSTOMER_ID);
    });

    it('a cache failure after commit does NOT fail the (already committed) post', async () => {
      const { service, cache, committed } = buildService(ALL);
      cache.invalidateOverview.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.create(USER, dto())).resolves.toMatchObject({ idempotentReplay: false });
      expect(committed).toHaveLength(4);
    });
  });
});
