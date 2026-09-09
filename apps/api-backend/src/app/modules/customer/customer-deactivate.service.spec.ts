import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, TransactionType } from '@prisma/client';
import { CustomerService } from './customer.service';

// ─── fixtures ────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const CUSTOMER_ID = 'customer-001';

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

// ─── service factory ─────────────────────────────────────────────────────────

function makeService(opts: {
  customer?: Partial<typeof baseCustomer>;
  /** rows the PENDING→CANCELLED updateMany reports as affected */
  pendingCancelled?: number;
  outstandingWallets?: Array<{ balance: number; product: { name: string } }>;
  hasForcePermission?: boolean;
} = {}) {
  const customer = { ...baseCustomer, ...opts.customer };

  const tx = {
    dailySheetItem: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.pendingCancelled ?? 0 }),
    },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'tx-001' }) },
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
  const permissions = { can: jest.fn().mockResolvedValue(opts.hasForcePermission ?? false) };
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

describe('CustomerService.deactivate — balance guard, force write-off, pending-delivery auto-cancel', () => {
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

  it('blocks a non-force deactivate when the customer owes money (OUTSTANDING_BALANCE)', async () => {
    const { svc } = makeService({ customer: { financialBalance: 1500 } });
    expect.assertions(3);
    try {
      await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: false }, salesmanUser);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = (e as ConflictException).getResponse() as any;
      expect(body.code).toBe('OUTSTANDING_BALANCE');
      expect(body.financialBalance).toBe(1500);
    }
  });

  it('still blocks force when the actor lacks customers:force_deactivate (403)', async () => {
    const { svc, permissions } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: false,
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, salesmanUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissions.can).toHaveBeenCalledWith('sales-001', 'customers:force_deactivate');
  });

  it('force-deactivates with permission: cancels pending stops, writes the balance off as an ADJUSTMENT, audits FORCE_DEACTIVATE', async () => {
    const { svc, tx, prisma, audit, cache } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: true,
      pendingCancelled: 2,
    });

    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);
    expect(res.cancelledDeliveries).toBe(2);

    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: DeliveryStatus.CANCELLED } }),
    );
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
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(prisma.customer.update).not.toHaveBeenCalled(); // forced path stays inside $transaction
    expect(cache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
    expect(cache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FORCE_DEACTIVATE',
        changes: expect.objectContaining({
          after: expect.objectContaining({ writtenOff: 1500, cancelledDeliveries: 2 }),
        }),
      }),
    );
  });

  it('force does NOT bypass the outstanding-bottle guard', async () => {
    const { svc, tx } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: true,
      outstandingWallets: [{ balance: 3, product: { name: '19L' } }],
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toThrow(/outstanding bottles/i);
    expect(tx.dailySheetItem.updateMany).not.toHaveBeenCalled();
  });
});
