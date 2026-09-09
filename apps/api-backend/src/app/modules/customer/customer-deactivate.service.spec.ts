import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
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
  pendingItems?: number;
  outstandingWallets?: Array<{ balance: number; product: { name: string } }>;
  hasForcePermission?: boolean;
} = {}) {
  const customer = { ...baseCustomer, ...opts.customer };

  const tx = {
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
      update: jest
        .fn()
        .mockResolvedValue({ id: CUSTOMER_ID, name: customer.name, customerCode: customer.customerCode, isActive: false }),
    },
    dailySheetItem: { count: jest.fn().mockResolvedValue(opts.pendingItems ?? 0) },
    bottleWallet: { findMany: jest.fn().mockResolvedValue(opts.outstandingWallets ?? []) },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };

  const cache = {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
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

describe('CustomerService.deactivate — outstanding-balance guard + force write-off', () => {
  it('404s when the customer does not belong to the vendor', async () => {
    const { svc, prisma } = makeService();
    prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, adminUser)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates cleanly when nothing is owed', async () => {
    const { svc, prisma, audit } = makeService({ customer: { financialBalance: 0 } });
    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, {}, salesmanUser);
    expect(res.isActive).toBe(false);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEACTIVATE' }));
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

  it('force-deactivates with permission: writes the balance off as an ADJUSTMENT and audits FORCE_DEACTIVATE', async () => {
    const { svc, tx, prisma, audit, cache } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: true,
    });

    const res = await svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser);
    expect(res.isActive).toBe(false);

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
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FORCE_DEACTIVATE',
        changes: expect.objectContaining({ after: expect.objectContaining({ writtenOff: 1500 }) }),
      }),
    );
  });

  it('force does NOT bypass the outstanding-bottle guard', async () => {
    const { svc } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: true,
      outstandingWallets: [{ balance: 3, product: { name: '19L' } }],
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toThrow(/outstanding bottles/i);
  });

  it('force does NOT bypass the pending-delivery guard', async () => {
    const { svc } = makeService({
      customer: { financialBalance: 1500 },
      hasForcePermission: true,
      pendingItems: 2,
    });
    await expect(
      svc.deactivate(VENDOR_ID, CUSTOMER_ID, { force: true }, adminUser),
    ).rejects.toThrow(/pending delivery item/i);
  });
});
