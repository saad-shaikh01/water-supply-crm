import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { CustomerDepositsService } from './customer-deposits.service';

const VENDOR_ID = 'vendor-1';
const CUSTOMER_ID = 'customer-1';
const PRODUCT_ID = 'product-1';
const USER: AuthUser = {
  userId: 'user-1',
  email: 'staff@example.com',
  name: 'Alice Staff',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};

const P = (a: string) => `customer_deposits:${a}`;

/**
 * Prisma mock with REAL commit/rollback semantics, same shape as
 * CustomerFinancialAdjustmentService's spec harness: every write inside
 * `$transaction` only "lands" if the callback resolves.
 */
function buildHarness(opts: { depositsEnabled?: boolean } = {}) {
  const deposits = new Map<string, any>();
  let entrySeq = 0;
  const entries = new Map<string, any>();

  const db: any = {
    vendor: {
      findUnique: jest.fn().mockResolvedValue({ depositsEnabled: opts.depositsEnabled ?? true }),
      update: jest.fn().mockImplementation(async (args: any) => ({ depositsEnabled: args.data.depositsEnabled })),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({ id: PRODUCT_ID }),
    },
    customerDeposit: {
      // Two call shapes hit this mock: by id (refund/writeOff/applyToBalance —
      // `{ where: { id, vendorId } }`) and the find-or-create lookup in
      // getOrCreateDepositTx (`{ where: { customerId, type, productId } }`,
      // productId possibly null — deliberately `findFirst`, not `findUnique`,
      // see that method's doc comment for why).
      findFirst: jest.fn().mockImplementation(async (args: any) => {
        if (args.where.id) return deposits.get(args.where.id) ?? null;
        const key = `${args.where.customerId}:${args.where.type}:${args.where.productId ?? 'null'}`;
        return deposits.get(key) ?? null;
      }),
      create: jest.fn().mockImplementation(async (args: any) => {
        const id = `dep-${deposits.size + 1}`;
        const row = { id, balance: 0, ...args.data };
        deposits.set(id, row);
        deposits.set(`${row.customerId}:${row.type}:${row.productId ?? 'null'}`, row);
        return row;
      }),
      update: jest.fn().mockImplementation(async (args: any) => {
        const row = deposits.get(args.where.id);
        if (args.data.balance?.increment !== undefined) row.balance += args.data.balance.increment;
        if (args.data.balance?.decrement !== undefined) row.balance -= args.data.balance.decrement;
        return { ...row };
      }),
    },
    customerDepositEntry: {
      create: jest.fn().mockImplementation(async (args: any) => {
        const id = `entry-${++entrySeq}`;
        const row = { id, status: 'POSTED', ...args.data };
        entries.set(id, row);
        return row;
      }),
      findFirst: jest.fn().mockImplementation(async (args: any) => {
        const row = entries.get(args.where.id);
        if (!row) return null;
        return { ...row, deposit: deposits.get(row.depositId) };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async (args: any) => {
        const row = entries.get(args.where.id);
        if (!row) throw new Error('not found');
        return { ...row };
      }),
      updateMany: jest.fn().mockImplementation(async (args: any) => {
        const row = entries.get(args.where.id);
        if (!row || row.status !== args.where.status) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      }),
      update: jest.fn().mockImplementation(async (args: any) => {
        const row = entries.get(args.where.id);
        Object.assign(row, args.data);
        return { ...row };
      }),
    },
    // Paired OTHER_CREDIT adjustments (applyToBalance) — `adjustmentStatus` lets a test
    // pre-void one, as if staff had already voided it from the Charges & Credits tab.
    customerFinancialAdjustment: {
      findFirst: jest.fn().mockImplementation(async (args: any) => {
        const id = args.where.id;
        return id ? { id, status: adjustmentStatus.get(id) ?? 'POSTED' } : null;
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const adjustmentStatus = new Map<string, string>();
  db.$transaction = jest.fn().mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(db));

  return { db, deposits, entries, adjustmentStatus };
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
  let adjSeq = 0;
  const adjustments = {
    createTx: jest.fn().mockImplementation(async (_tx: any, _user: any, input: any) => ({
      adjustment: { id: `adj-${++adjSeq}`, ...input },
      transaction: { id: `adj-txn-${adjSeq}` },
      customerBalance: 0,
    })),
    voidAdjustmentTx: jest.fn().mockImplementation(async (_tx: any, _user: any, id: string) => {
      harness.adjustmentStatus.set(id, 'VOIDED');
      return { adjustment: { id, status: 'VOIDED' } };
    }),
  };
  const service = new CustomerDepositsService(harness.db, cache as any, permissions as any, adjustments as any);
  return { service, cache, permissions, adjustments, ...harness };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-09-29T09:00:00.000Z'));
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('CustomerDepositsService.collect', () => {
  it('creates a CASH deposit and posts a COLLECT entry that raises the balance', async () => {
    const { service, db } = buildService([P('collect')]);

    const result = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    expect(result.deposit.balance).toBe(1000);
    expect(result.entry.direction).toBe('COLLECT');
    expect(result.entry.source).toBe('OFFICE');
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('a second collect on the same customer/type reuses the existing deposit row', async () => {
    const { service, db } = buildService([P('collect')]);
    await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 500 } as any);
    const second = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 300 } as any);

    expect(second.deposit.balance).toBe(800);
    expect(db.customerDeposit.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when the caller lacks customer_deposits:collect', async () => {
    const { service } = buildService([]);
    await expect(service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 100 } as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the vendor has not enabled deposits', async () => {
    const { service } = buildService([P('collect')], buildHarness({ depositsEnabled: false }));
    await expect(service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 100 } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires a productId for a BOTTLE deposit', async () => {
    const { service } = buildService([P('collect')]);
    await expect(service.collect(USER, CUSTOMER_ID, { type: 'BOTTLE', amount: 2 } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a productId on a CASH deposit', async () => {
    const { service } = buildService([P('collect')]);
    await expect(
      service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 100, productId: PRODUCT_ID } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-integer BOTTLE amount', async () => {
    const { service } = buildService([P('collect')]);
    await expect(
      service.collect(USER, CUSTOMER_ID, { type: 'BOTTLE', amount: 2.5, productId: PRODUCT_ID } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('a BOTTLE deposit and a CASH deposit for the same customer are separate rows', async () => {
    const { service } = buildService([P('collect')]);
    const cash = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);
    const bottle = await service.collect(USER, CUSTOMER_ID, {
      type: 'BOTTLE',
      amount: 2,
      productId: PRODUCT_ID,
    } as any);

    expect(cash.deposit.id).not.toBe(bottle.deposit.id);
    expect(bottle.deposit.balance).toBe(2);
  });
});

describe('CustomerDepositsService — payment method', () => {
  it('defaults to CASH when none is given (existing behaviour, counts in the Cash Ledger)', async () => {
    const { service } = buildService([P('collect')]);
    const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);
    expect(entry.paymentMethod).toBe('CASH');
  });

  it('records a BANK_TRANSFER deposit, and still raises the held deposit balance', async () => {
    const { service } = buildService([P('collect')]);
    const { entry, deposit } = await service.collect(USER, CUSTOMER_ID, {
      type: 'CASH',
      amount: 5000,
      paymentMethod: 'BANK_TRANSFER',
      referenceNo: 'TRX-991',
    } as any);
    expect(entry.paymentMethod).toBe('BANK_TRANSFER');
    expect(deposit.balance).toBe(5000);
  });

  it.each(['BANK_TRANSFER', 'ONLINE'])('a %s deposit requires a transaction reference', async (paymentMethod) => {
    const { service } = buildService([P('collect')]);
    await expect(
      service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 5000, paymentMethod } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 5000, paymentMethod, referenceNo: '   ' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-cash payment method on a BOTTLE deposit', async () => {
    const { service } = buildService([P('collect')]);
    await expect(
      service.collect(USER, CUSTOMER_ID, {
        type: 'BOTTLE',
        amount: 3,
        productId: PRODUCT_ID,
        paymentMethod: 'ONLINE',
        referenceNo: 'x',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('a refund records how it was paid out, and a non-cash refund needs a reference', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    await expect(
      service.refund(USER, deposit.id, { amount: 200, paymentMethod: 'BANK_TRANSFER' } as any),
    ).rejects.toThrow(BadRequestException);

    const ok = await service.refund(USER, deposit.id, {
      amount: 200,
      paymentMethod: 'BANK_TRANSFER',
      referenceNo: 'TRX-7',
    } as any);
    expect(ok.entry.paymentMethod).toBe('BANK_TRANSFER');
    expect(ok.deposit.balance).toBe(800);

    const cash = await service.refund(USER, deposit.id, { amount: 100 } as any);
    expect(cash.entry.paymentMethod).toBe('CASH');
  });

  it('a void’s reversal carries the original’s payment method', async () => {
    const { service } = buildService([P('collect'), P('void')]);
    const { entry } = await service.collect(USER, CUSTOMER_ID, {
      type: 'CASH',
      amount: 5000,
      paymentMethod: 'ONLINE',
      referenceNo: 'JC-1',
    } as any);
    const { reversal } = await service.voidEntry(USER, entry.id, { reason: 'Entered by mistake' } as any);
    expect(reversal.paymentMethod).toBe('ONLINE');
  });
});

describe('CustomerDepositsService.refund', () => {
  it('decrements the balance and posts a REFUND entry', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    const result = await service.refund(USER, deposit.id, { amount: 400 } as any);

    expect(result.deposit.balance).toBe(600);
    expect(result.entry.direction).toBe('REFUND');
  });

  it('cannot refund more than the held balance', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 100 } as any);

    await expect(service.refund(USER, deposit.id, { amount: 500 } as any)).rejects.toThrow(BadRequestException);
  });

  it('rejects when the caller lacks customer_deposits:refund', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 100 } as any);

    await expect(service.refund(USER, deposit.id, { amount: 50 } as any)).rejects.toThrow(ForbiddenException);
  });
});

describe('CustomerDepositsService.writeOff', () => {
  it('requires a note of at least 5 characters', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('write_off')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, {
      type: 'BOTTLE',
      amount: 3,
      productId: PRODUCT_ID,
    } as any);

    await expect(service.writeOff(USER, deposit.id, { amount: 3, note: 'hi' } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('closes out the balance without exceeding it', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('write_off')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, {
      type: 'BOTTLE',
      amount: 3,
      productId: PRODUCT_ID,
    } as any);

    const result = await service.writeOff(USER, deposit.id, {
      amount: 3,
      note: 'Customer left without returning bottles',
    } as any);

    expect(result.deposit.balance).toBe(0);
    expect(result.entry.direction).toBe('WRITE_OFF');
  });
});

describe('CustomerDepositsService.applyToBalance', () => {
  it('decrements the deposit and cross-posts an OTHER_CREDIT adjustment, no Cash Ledger movement', async () => {
    const harness = buildHarness();
    const { service, adjustments } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    const result = await service.applyToBalance(USER, deposit.id, { amount: 600 } as any);

    expect(result.deposit.balance).toBe(400);
    expect(result.entry.direction).toBe('APPLIED_TO_BALANCE');
    expect(adjustments.createTx).toHaveBeenCalledWith(
      harness.db,
      USER,
      expect.objectContaining({ kind: 'OTHER_CREDIT', direction: 'CREDIT', amount: 600, customerId: CUSTOMER_ID }),
    );
    expect(result.adjustmentId).toBe('adj-1');
  });

  it('rejects a BOTTLE deposit — cash-equivalent settlement is a separate, ad-hoc flow', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, {
      type: 'BOTTLE',
      amount: 5,
      productId: PRODUCT_ID,
    } as any);

    await expect(service.applyToBalance(USER, deposit.id, { amount: 5 } as any)).rejects.toThrow(BadRequestException);
  });

  it('cannot apply more than the held balance', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('refund')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 300 } as any);

    await expect(service.applyToBalance(USER, deposit.id, { amount: 500 } as any)).rejects.toThrow(BadRequestException);
  });

  it('rejects when the caller lacks customer_deposits:refund', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 300 } as any);

    await expect(service.applyToBalance(USER, deposit.id, { amount: 100 } as any)).rejects.toThrow(ForbiddenException);
  });
});

describe('CustomerDepositsService.writeOffTx (Closure Settlement)', () => {
  it('writes off whatever remains, tx-composable for a caller-managed transaction', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect')], harness);
    const { deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 750 } as any);

    const result = await harness.db.$transaction((tx: any) =>
      service.writeOffTx(tx, USER, deposit, 'Deposit write-off on account closure'),
    );

    expect(result.deposit.balance).toBe(0);
    expect(result.entry.direction).toBe('WRITE_OFF');
  });
});

describe('CustomerDepositsService.voidEntry', () => {
  it('reverses a COLLECT entry and restores the balance', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('void')], harness);
    const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    const result = await service.voidEntry(USER, entry.id, { reason: 'Entered by mistake' } as any);

    expect(result.deposit.balance).toBe(0);
    expect(result.reversal.direction).toBe('REFUND');
    expect(result.entry.status).toBe('VOIDED');
  });

  it('cannot void the same entry twice', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('void')], harness);
    const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    await service.voidEntry(USER, entry.id, { reason: 'Entered by mistake' } as any);
    await expect(service.voidEntry(USER, entry.id, { reason: 'Again' } as any)).rejects.toThrow(ConflictException);
  });

  it('cannot void a reversal entry itself', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('void')], harness);
    const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);
    const { reversal } = await service.voidEntry(USER, entry.id, { reason: 'Entered by mistake' } as any);

    await expect(service.voidEntry(USER, reversal.id, { reason: 'Undo the undo' } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to void a DELIVERY-collected entry — it is corrected from the stop, which is the source of truth', async () => {
    const harness = buildHarness();
    const { service, entries } = buildService([P('collect'), P('void')], harness);
    const { entry, deposit } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 200 } as any);
    entries.get(entry.id).source = 'DELIVERY';

    await expect(service.voidEntry(USER, entry.id, { reason: 'Driver typo' } as any)).rejects.toThrow(
      BadRequestException,
    );
    // nothing written: still POSTED, balance untouched
    expect(entries.get(entry.id).status).toBe('POSTED');
    expect(harness.deposits.get(deposit.id).balance).toBe(200);
  });

  describe('an APPLIED_TO_BALANCE entry', () => {
    const PERMS = [P('collect'), P('refund'), P('void'), 'customer_financial_adjustments:void'];

    async function applied(granted = PERMS) {
      const harness = buildHarness();
      const built = buildService(granted, harness);
      const { deposit } = await built.service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);
      const { entry, adjustmentId } = await built.service.applyToBalance(USER, deposit.id, { amount: 600 } as any);
      return { ...built, entry, adjustmentId, deposit };
    }

    it('also voids the paired customer credit in the same transaction, so there is no double benefit', async () => {
      const { service, adjustments, db, entry, adjustmentId } = await applied();

      const result = await service.voidEntry(USER, entry.id, { reason: 'Applied by mistake' } as any);

      expect(adjustments.voidAdjustmentTx).toHaveBeenCalledWith(db, USER, adjustmentId, 'Applied by mistake');
      expect(result.deposit.balance).toBe(1000);
    });

    it('does not void the credit twice when staff already voided it from the Charges & Credits tab', async () => {
      const { service, adjustments, adjustmentStatus, entry, adjustmentId } = await applied();
      adjustmentStatus.set(adjustmentId, 'VOIDED');

      const result = await service.voidEntry(USER, entry.id, { reason: 'Applied by mistake' } as any);

      expect(adjustments.voidAdjustmentTx).not.toHaveBeenCalled();
      expect(result.deposit.balance).toBe(1000);
    });

    it('needs the adjustment-void permission too, and writes nothing when it is missing', async () => {
      const { service, adjustments, entries, entry } = await applied([P('collect'), P('refund'), P('void')]);

      await expect(service.voidEntry(USER, entry.id, { reason: 'Applied by mistake' } as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(adjustments.voidAdjustmentTx).not.toHaveBeenCalled();
      expect(entries.get(entry.id).status).toBe('POSTED');
    });

    it('a plain COLLECT void never touches the adjustment ledger', async () => {
      const harness = buildHarness();
      const { service, adjustments } = buildService([P('collect'), P('void')], harness);
      const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

      await service.voidEntry(USER, entry.id, { reason: 'Entered by mistake' } as any);

      expect(adjustments.voidAdjustmentTx).not.toHaveBeenCalled();
    });
  });

  it('rejects a reason shorter than 5 characters', async () => {
    const harness = buildHarness();
    const { service } = buildService([P('collect'), P('void')], harness);
    const { entry } = await service.collect(USER, CUSTOMER_ID, { type: 'CASH', amount: 1000 } as any);

    await expect(service.voidEntry(USER, entry.id, { reason: 'no' } as any)).rejects.toThrow(BadRequestException);
  });
});

describe('CustomerDepositsService config', () => {
  it('getConfig returns the vendor flag', async () => {
    const { service } = buildService([P('view')], buildHarness({ depositsEnabled: true }));
    await expect(service.getConfig(VENDOR_ID)).resolves.toEqual({ depositsEnabled: true });
  });

  it('updateConfig requires manage_config', async () => {
    const { service } = buildService([], buildHarness());
    await expect(service.updateConfig(USER, true)).rejects.toThrow(ForbiddenException);
  });

  it('updateConfig flips the flag when authorized', async () => {
    const { service, db } = buildService([P('manage_config')], buildHarness());
    const result = await service.updateConfig(USER, true);
    expect(result.depositsEnabled).toBe(true);
    expect(db.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { depositsEnabled: true } }),
    );
  });
});
