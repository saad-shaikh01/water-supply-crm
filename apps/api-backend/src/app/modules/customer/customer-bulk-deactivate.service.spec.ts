import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, TransactionType } from '@prisma/client';
import { CustomerService } from './customer.service';

// ─── fixtures ────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const CLEAN_ID = 'customer-clean'; // no blockers
const BALANCE_ID = 'customer-balance'; // owes money only
const BOTTLES_ID = 'customer-bottles'; // holds bottles only
const PRODUCT_ID = 'product-19l';

const adminUser = { userId: 'admin-001', name: 'Owner', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

const CUSTOMERS: Record<string, { id: string; name: string; financialBalance: number }> = {
  [CLEAN_ID]: { id: CLEAN_ID, name: 'Clean Co', financialBalance: 0 },
  [BALANCE_ID]: { id: BALANCE_ID, name: 'Balance Co', financialBalance: 2000 },
  [BOTTLES_ID]: { id: BOTTLES_ID, name: 'Bottles Co', financialBalance: 0 },
};

const WALLETS: Record<string, Array<{ balance: number; productId: string; product: { name: string } }>> = {
  [CLEAN_ID]: [],
  [BALANCE_ID]: [],
  [BOTTLES_ID]: [{ balance: 4, productId: PRODUCT_ID, product: { name: '19L' } }],
};

// ─── service factory ─────────────────────────────────────────────────────────

function makeService(opts: {
  customerIds: string[];
  perms?: { balance?: boolean; bottles?: boolean };
  pendingCancelled?: number;
} ) {
  const tx = {
    dailySheetItem: { updateMany: jest.fn().mockResolvedValue({ count: opts.pendingCancelled ?? 0 }) },
    customer: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'tx-001' }) },
    bottleWallet: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    customer: {
      findMany: jest.fn().mockResolvedValue(opts.customerIds.map((id) => CUSTOMERS[id])),
    },
    bottleWallet: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => WALLETS[where.customerId] ?? []),
    },
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
      return false;
    }),
  };
  const bulkPriceQueue = {};

  const svc = new CustomerService(
    prisma as any,
    cache as any,
    statementPdf as any,
    audit as any,
    permissions as any,
    bulkPriceQueue as any,
  );
  return { svc, prisma, tx, cache, audit, permissions };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('CustomerService.bulkDeactivate — force write-off across the batch', () => {
  it('404s when none of the requested ids match an active customer', async () => {
    const { svc, prisma } = makeService({ customerIds: [] });
    prisma.customer.findMany.mockResolvedValueOnce([]);
    await expect(
      svc.bulkDeactivate(VENDOR_ID, { customerIds: [CLEAN_ID] } as any, adminUser),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('without force: skips balance/bottle customers, deactivates the clean one, cancels pending stops for it', async () => {
    const { svc, tx } = makeService({ customerIds: [CLEAN_ID, BALANCE_ID, BOTTLES_ID], pendingCancelled: 1 });
    const res = await svc.bulkDeactivate(VENDOR_ID, { customerIds: [CLEAN_ID, BALANCE_ID, BOTTLES_ID] } as any);
    expect(res.deactivatedCount).toBe(1);
    expect(res.forceDeactivatedCount).toBe(0);
    expect(res.skippedCount).toBe(2);
    expect(res.skipped.map((s) => s.customerId).sort()).toEqual([BALANCE_ID, BOTTLES_ID].sort());
    expect(res.skipped.every((s) => s.reason.includes('deactivate individually or with Force'))).toBe(true);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({ where: { id: { in: [CLEAN_ID] } }, data: { isActive: false } });
    expect(res.cancelledDeliveries).toBe(1);
  });

  it('force=true without an actor throws 403', async () => {
    const { svc } = makeService({ customerIds: [BALANCE_ID] });
    await expect(
      svc.bulkDeactivate(VENDOR_ID, { customerIds: [BALANCE_ID], force: true } as any, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('force=true with only the balance permission: writes off the balance customer, still skips the bottles one', async () => {
    const { svc, tx } = makeService({ customerIds: [BALANCE_ID, BOTTLES_ID], perms: { balance: true } });
    const result = await svc.bulkDeactivate(
      VENDOR_ID,
      { customerIds: [BALANCE_ID, BOTTLES_ID], force: true } as any,
      adminUser,
    );
    expect(result.forceDeactivatedCount).toBe(1);
    expect(result.writtenOff).toBe(2000);
    expect(result.bottlesWrittenOff).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0].customerId).toBe(BOTTLES_ID);
    expect(result.skipped[0].reason).toContain('missing customers:force_deactivate_bottles');

    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: TransactionType.ADJUSTMENT, customerId: BALANCE_ID, amount: -2000 }),
      }),
    );
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BALANCE_ID }, data: { financialBalance: { increment: -2000 } } }),
    );
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: BALANCE_ID }, data: { isActive: false } });
    expect(tx.bottleWallet.update).not.toHaveBeenCalled();
  });

  it('force=true with both permissions: writes off balance AND bottles, audits BULK_FORCE_DEACTIVATE', async () => {
    const { svc, tx, audit, cache } = makeService({
      customerIds: [BALANCE_ID, BOTTLES_ID],
      perms: { balance: true, bottles: true },
      pendingCancelled: 2,
    });

    const result = await svc.bulkDeactivate(
      VENDOR_ID,
      { customerIds: [BALANCE_ID, BOTTLES_ID], force: true } as any,
      adminUser,
    );

    expect(result.deactivatedCount).toBe(2);
    expect(result.forceDeactivatedCount).toBe(2);
    expect(result.writtenOff).toBe(2000);
    expect(result.bottlesWrittenOff).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.cancelledDeliveries).toBe(2);

    expect(tx.bottleWallet.update).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: BOTTLES_ID, productId: PRODUCT_ID } },
      data: { balance: { increment: -4 } },
    });
    expect(cache.invalidateCustomerWallets).toHaveBeenCalledWith(VENDOR_ID, BOTTLES_ID);
    expect(cache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BULK_FORCE_DEACTIVATE',
        changes: expect.objectContaining({
          after: expect.objectContaining({ forceDeactivatedCount: 2, writtenOff: 2000, bottlesWrittenOff: 1 }),
        }),
      }),
    );
  });

  it('cancels PENDING stops for both normally-deactivated and force-deactivated customers in one pass', async () => {
    const { svc, tx } = makeService({
      customerIds: [CLEAN_ID, BALANCE_ID],
      perms: { balance: true },
      pendingCancelled: 5,
    });
    await svc.bulkDeactivate(VENDOR_ID, { customerIds: [CLEAN_ID, BALANCE_ID], force: true } as any, adminUser);
    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: { in: [CLEAN_ID, BALANCE_ID] },
        status: DeliveryStatus.PENDING,
        dailySheet: { isClosed: false },
      },
      data: { status: DeliveryStatus.CANCELLED },
    });
  });
});
