import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, TransactionType } from '@prisma/client';
import { CustomerService } from './customer.service';

// ─── fixtures ────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const CUSTOMER_ID = 'customer-001';
const PRODUCT_ID = 'product-19l';

const adminUser = { userId: 'admin-001', name: 'Owner', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;
const salesmanUser = { userId: 'sales-001', name: 'Field Sales', vendorId: VENDOR_ID, role: 'SALESMAN' } as any;

const baseCustomer = {
  id: CUSTOMER_ID,
  vendorId: VENDOR_ID,
  name: 'Acme Water Co',
  customerCode: 'C-001',
  isActive: true,
  financialBalance: 0,
};

const wallet19L = { balance: 3, productId: PRODUCT_ID, product: { name: '19L' } };

// ─── service factory ─────────────────────────────────────────────────────────

function makeService(opts: {
  customer?: Partial<typeof baseCustomer>;
  /** rows the PENDING→CANCELLED updateMany reports as affected */
  pendingCancelled?: number;
  outstandingWallets?: Array<{ balance: number; productId: string; product: { name: string } }>;
  /** CustomerDeposit rows with an active (non-zero) balance — Closure Settlement. */
  activeDeposits?: Array<{ id: string; customerId: string; type: 'CASH' | 'BOTTLE'; productId: string | null; balance: number; product?: { name: string } | null }>;
  /** which force permissions the actor holds */
  perms?: { balance?: boolean; bottles?: boolean; deposits?: boolean };
} = {}) {
  const customer = { ...baseCustomer, ...opts.customer };

  const tx = {
    dailySheetItem: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.pendingCancelled ?? 0 }),
    },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'tx-001' }) },
    bottleWallet: { update: jest.fn().mockResolvedValue({}) },
    customer: {
      update: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ ...customer, ...data, isActive: data.isActive ?? customer.isActive })),
    },
  };

  const prisma = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
      update: jest.fn().mockResolvedValue({ id: CUSTOMER_ID, isActive: false }),
    },
    bottleWallet: { findMany: jest.fn().mockResolvedValue(opts.outstandingWallets ?? []) },
    customerDeposit: { findMany: jest.fn().mockResolvedValue(opts.activeDeposits ?? []) },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };

  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
    invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
  };
  const statementPdf = {};
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const permissions = {
    can: jest.fn().mockImplementation(async (_userId: string, perm: string) => {
      if (perm === 'customers:force_deactivate') return opts.perms?.balance ?? false;
      if (perm === 'customers:force_deactivate_bottles') return opts.perms?.bottles ?? false;
      if (perm === 'customer_deposits:write_off') return opts.perms?.deposits ?? false;
      return false;
    }),
  };
  const customerDeposits = { writeOffTx: jest.fn().mockResolvedValue(undefined) };
  const bulkPriceQueue = {};

  const svc = new CustomerService(
    prisma as any,
    cache as any,
    statementPdf as any,
    audit as any,
    permissions as any,
    customerDeposits as any,
    bulkPriceQueue as any,
    {} as any, // VendorBrandingService (statement PDFs only)
  );
  return { svc, prisma, tx, cache, audit, permissions, customerDeposits };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('CustomerService.deactivate — blockers, force write-off (balance + bottles), pending auto-cancel', () => {
  it('404s when the customer does not belong to the vendor', async () => {
    const { svc, prisma } = makeService();
    prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, adminUser)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates cleanly when nothing is owed, inside a transaction', async () => {
    const { svc, tx, audit } = makeService({ customer: { financialBalance: 0 } });
    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, salesmanUser);
    expect(res.isActive).toBe(false);
    expect(res.cancelledDeliveries).toBe(0);
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEACTIVATE' }));
  });

  it('auto-cancels the customer’s PENDING stops on open sheets and reports the count', async () => {
    const { svc, tx, cache } = makeService({ customer: { financialBalance: 0 }, pendingCancelled: 3 });
    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, salesmanUser);
    expect(res.cancelledDeliveries).toBe(3);
    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: CUSTOMER_ID,
        status: DeliveryStatus.PENDING,
        dailySheet: { isClosed: false },
      },
      data: { status: DeliveryStatus.CANCELLED },
    });
    expect(cache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID);
  });

  it('does not touch the daily dashboard cache when no pending stop was cancelled', async () => {
    const { svc, cache } = makeService({ customer: { financialBalance: 0 }, pendingCancelled: 0 });
    await svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, salesmanUser);
    expect(cache.invalidateDailyDashboard).not.toHaveBeenCalled();
  });

  it('blocks a non-force deactivate with DEACTIVATE_BLOCKED carrying every blocker (balance + bottles)', async () => {
    const { svc } = makeService({
      customer: { financialBalance: 1500 },
      outstandingWallets: [wallet19L],
    });
    expect.assertions(4);
    try {
      await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: false }, salesmanUser);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = (e as ConflictException).getResponse() as any;
      expect(body.code).toBe('DEACTIVATE_BLOCKED');
      expect(body.financialBalance).toBe(1500);
      expect(body.outstandingBottles).toEqual([{ product: '19L', balance: 3 }]);
    }
  });

  it('force with only the balance permission still 403s when the customer holds bottles', async () => {
    const { svc, tx } = makeService({
      customer: { financialBalance: 1500 },
      outstandingWallets: [wallet19L],
      perms: { balance: true, bottles: false },
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.dailySheetItem.updateMany).not.toHaveBeenCalled(); // nothing written before the guard
  });

  it('force with only the bottles permission still 403s when the customer owes a balance', async () => {
    const { svc } = makeService({
      customer: { financialBalance: 1500 },
      outstandingWallets: [wallet19L],
      perms: { balance: false, bottles: true },
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('force with force_deactivate only: writes the balance off as an ADJUSTMENT (no bottles present)', async () => {
    const { svc, tx, audit } = makeService({
      customer: { financialBalance: 1500 },
      perms: { balance: true },
      pendingCancelled: 2,
    });

    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);
    expect(res.cancelledDeliveries).toBe(2);

    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TransactionType.ADJUSTMENT,
          customerId: CUSTOMER_ID,
          amount: -1500,
        }),
      }),
    );
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { financialBalance: { increment: -1500 } } }),
    );
    expect(tx.bottleWallet.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FORCE_DEACTIVATE',
        changes: expect.objectContaining({
          after: expect.objectContaining({ writtenOff: 1500, cancelledDeliveries: 2 }),
        }),
      }),
    );
  });

  it('force with both permissions: writes off the balance AND zeroes every bottle wallet with a matching ADJUSTMENT', async () => {
    const { svc, tx, cache, audit } = makeService({
      customer: { financialBalance: 1500 },
      outstandingWallets: [wallet19L, { balance: -1, productId: 'product-5l', product: { name: '5L' } }],
      perms: { balance: true, bottles: true },
      pendingCancelled: 1,
    });

    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);
    expect((res as any).writtenOff).toBe(1500);
    expect((res as any).bottlesWrittenOff).toEqual([
      { product: '19L', balance: 3 },
      { product: '5L', balance: -1 },
    ]);

    // balance ADJUSTMENT + one ADJUSTMENT per wallet = 3 transaction rows
    expect(tx.transaction.create).toHaveBeenCalledTimes(3);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TransactionType.ADJUSTMENT,
          productId: PRODUCT_ID,
          bottleCount: -3,
          amount: 0,
        }),
      }),
    );
    expect(tx.bottleWallet.update).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: CUSTOMER_ID, productId: PRODUCT_ID } },
      data: { balance: { increment: -3 } },
    });
    expect(tx.bottleWallet.update).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: CUSTOMER_ID, productId: 'product-5l' } },
      data: { balance: { increment: 1 } },
    });
    expect(cache.invalidateCustomerWallets).toHaveBeenCalledWith(VENDOR_ID, CUSTOMER_ID);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FORCE_DEACTIVATE',
        changes: expect.objectContaining({
          after: expect.objectContaining({
            writtenOff: 1500,
            bottlesWrittenOff: [
              { product: '19L', balance: 3 },
              { product: '5L', balance: -1 },
            ],
          }),
        }),
      }),
    );
  });

  it('force with force_deactivate_bottles only: bottles-only customer is written off without the balance permission', async () => {
    const { svc, tx } = makeService({
      customer: { financialBalance: 0 },
      outstandingWallets: [wallet19L],
      perms: { balance: false, bottles: true },
    });
    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);
    expect(tx.bottleWallet.update).toHaveBeenCalledTimes(1);
    // no balance ADJUSTMENT — only the bottle one
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bottleCount: -3 }) }),
    );
  });

  // ─── Customer Deposits — Closure Settlement (owner-requested 2026-09-29) ──

  const cashDeposit = { id: 'dep-cash-1', customerId: CUSTOMER_ID, type: 'CASH' as const, productId: null, balance: 1000, product: null };
  const bottleDeposit = { id: 'dep-bottle-1', customerId: CUSTOMER_ID, type: 'BOTTLE' as const, productId: PRODUCT_ID, balance: 3, product: { name: '19L' } };

  it('blocks a non-force deactivate when the customer still holds a deposit, carrying it in the 409', async () => {
    const { svc } = makeService({ activeDeposits: [cashDeposit] });
    expect.assertions(2);
    try {
      await svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, adminUser);
    } catch (e) {
      const body = (e as ConflictException).getResponse() as any;
      expect(body.code).toBe('DEACTIVATE_BLOCKED');
      expect(body.outstandingDeposits).toEqual([
        expect.objectContaining({ id: 'dep-cash-1', type: 'CASH', balance: 1000 }),
      ]);
    }
  });

  it('force without customer_deposits:write_off still 403s when a deposit remains', async () => {
    const { svc, customerDeposits } = makeService({ activeDeposits: [cashDeposit], perms: { deposits: false } });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(customerDeposits.writeOffTx).not.toHaveBeenCalled();
  });

  it('force with customer_deposits:write_off writes off the remaining deposit via writeOffTx', async () => {
    const { svc, tx, customerDeposits } = makeService({
      customer: { financialBalance: 0 },
      activeDeposits: [cashDeposit],
      perms: { deposits: true },
    });
    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);
    expect((res as any).depositsWrittenOff).toEqual([
      expect.objectContaining({ id: 'dep-cash-1', type: 'CASH', balance: 1000 }),
    ]);
    // A deposit write-off is the company KEEPING what the customer handed
    // over as security (their forfeiture) — never a "company loss" (that
    // phrasing is reserved for the balance and the company's own unreturned
    // BottleWallet stock, a completely different, unrelated blocker).
    expect(customerDeposits.writeOffTx).toHaveBeenCalledWith(
      tx,
      adminUser,
      cashDeposit,
      expect.stringContaining('forfeited'),
    );
  });

  it('a BOTTLE deposit write-off uses the SAME forfeiture wording as CASH, never "company loss"', async () => {
    // The customer handed their OWN bottles to the company as security —
    // opposite direction from BottleWallet (the company's own circulating
    // stock) — so writing it off is symmetric with a CASH deposit: the
    // company keeps what it was already holding, the customer forfeits it.
    const { svc, tx, customerDeposits } = makeService({
      customer: { financialBalance: 0 },
      activeDeposits: [bottleDeposit],
      perms: { deposits: true },
    });
    await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(customerDeposits.writeOffTx).toHaveBeenCalledWith(
      tx,
      adminUser,
      bottleDeposit,
      expect.stringContaining('forfeited'),
    );
    const note = customerDeposits.writeOffTx.mock.calls[0][3] as string;
    expect(note).not.toMatch(/company loss/i);
  });
});
