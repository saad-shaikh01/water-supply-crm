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
      findUnique: jest.fn().mockImplementation(async (args: any) => {
        const key = `${args.where.customerId_type_productId.customerId}:${args.where.customerId_type_productId.type}:${args.where.customerId_type_productId.productId ?? 'null'}`;
        return deposits.get(key) ?? null;
      }),
      findFirst: jest.fn().mockImplementation(async (args: any) => deposits.get(args.where.id) ?? null),
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
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  db.$transaction = jest.fn().mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(db));

  return { db, deposits, entries };
}

function buildService(granted: string[], harness = buildHarness()) {
  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
  };
  const permissions = {
    can: jest.fn().mockImplementation(async (_userId: string, perm: string) => granted.includes(perm)),
  };
  const service = new CustomerDepositsService(harness.db, cache as any, permissions as any);
  return { service, cache, permissions, ...harness };
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
