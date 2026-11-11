import { Prisma } from '@prisma/client';
import { InvoiceService } from './invoice.service';

const actor = { userId: 'admin1', name: 'Super', role: 'SUPER_ADMIN', email: 'a', vendorId: null, customerId: null } as never;
const NOW = new Date('2026-11-12T00:00:00.000Z');
const D = (v: number) => new Prisma.Decimal(v);

interface Fixture {
  invoice?: Record<string, unknown>;
  paid?: number;
  sub?: Record<string, unknown> | null;
  vendorActive?: boolean;
}

function setup(f: Fixture = {}) {
  const invoice = { id: 'i1', vendorId: 'v1', subscriptionId: 's1', status: 'OPEN', amount: D(1000), ...f.invoice };
  const sub = f.sub === undefined
    ? { id: 's1', vendorId: 'v1', status: 'PAST_DUE', currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'), suspendedByBilling: false, plan: { interval: 'MONTHLY' } }
    : f.sub;
  const tx = {
    $queryRaw: jest.fn(async () => [{ n: BigInt(123), id: 'i1' }]),
    invoice: {
      findUnique: jest.fn(async () => invoice),
      update: jest.fn(async ({ data }: any) => ({ ...invoice, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
    },
    invoicePayment: {
      aggregate: jest.fn(async () => ({ _sum: { amount: f.paid ? D(f.paid) : null } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'pay1', ...data })),
    },
    vendorSubscription: {
      findUnique: jest.fn(async () => sub),
      update: jest.fn(async ({ data }: any) => ({ ...sub, ...data })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    $queryRaw: tx.$queryRaw,
    vendor: {
      findUnique: jest.fn(async () => ({ id: 'v1', isActive: f.vendorActive ?? true })),
    },
    vendorSubscription: { findUnique: jest.fn(async () => sub), update: jest.fn() },
    invoice: tx.invoice,
  };
  const audit = { log: jest.fn() };
  const vendors = { unsuspend: jest.fn() };
  const planLimits = { invalidate: jest.fn() };
  const svc = new InvoiceService(prisma as never, audit as never, vendors as never, planLimits as never);
  return { svc, prisma, tx, audit, vendors, planLimits };
}

const pay = (amount: number) => ({ amount, method: 'CASH' as const, paidOn: '2026-11-12' });

describe('InvoiceService.nextNumber', () => {
  it('formats INV-YYYY-000123 from the sequence', async () => {
    const { svc, tx } = setup();
    await expect(svc.nextNumber(tx as never, NOW)).resolves.toBe('INV-2026-000123');
  });
});

describe('InvoiceService.recordPayment', () => {
  it('runs inside a transaction and row-locks the invoice', async () => {
    const { svc, prisma, tx } = setup();
    await svc.recordPayment('i1', pay(400), actor, NOW);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('a partial payment keeps the invoice OPEN and leaves the subscription alone', async () => {
    const { svc, tx } = setup();
    const res = await svc.recordPayment('i1', pay(400), actor, NOW);
    expect(res.invoice.status).toBe('OPEN');
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.vendorSubscription.update).not.toHaveBeenCalled();
    expect(res.subscription).toBeNull();
  });

  it('the final payment marks it PAID, activates the subscription and advances one interval from now when lapsed', async () => {
    const { svc, tx } = setup({ paid: 400 });
    const res = await svc.recordPayment('i1', pay(600), actor, NOW);
    expect(res.invoice.status).toBe('PAID');
    expect(tx.invoice.update.mock.calls[0][0].data).toMatchObject({ status: 'PAID', paidAt: NOW });
    expect(tx.vendorSubscription.update.mock.calls[0][0].data).toMatchObject({
      status: 'ACTIVE',
      pastDueSince: null,
      currentPeriodStart: NOW,
      currentPeriodEnd: new Date('2026-12-12T00:00:00.000Z'),
    });
  });

  it('advances from the old period end when it is still in the future', async () => {
    const end = new Date('2026-11-20T00:00:00.000Z');
    const { svc, tx } = setup({
      sub: { id: 's1', vendorId: 'v1', status: 'ACTIVE', currentPeriodEnd: end, suspendedByBilling: false, plan: { interval: 'MONTHLY' } },
    });
    await svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(tx.vendorSubscription.update.mock.calls[0][0].data).toMatchObject({
      currentPeriodStart: end,
      currentPeriodEnd: new Date('2026-12-20T00:00:00.000Z'),
    });
  });

  it('rejects overpayment with 400', async () => {
    const { svc, tx } = setup({ paid: 800 });
    await expect(svc.recordPayment('i1', pay(300), actor, NOW)).rejects.toThrow(/exceeds/);
    expect(tx.invoicePayment.create).not.toHaveBeenCalled();
  });

  it('rejects payments on DRAFT, VOID and PAID invoices', async () => {
    for (const status of ['DRAFT', 'VOID', 'PAID']) {
      const { svc } = setup({ invoice: { status } });
      await expect(svc.recordPayment('i1', pay(10), actor, NOW)).rejects.toThrow();
    }
  });

  it('lifts a billing auto-suspension only when suspendedByBilling is set', async () => {
    const billing = setup({
      sub: { id: 's1', vendorId: 'v1', status: 'PAST_DUE', currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'), suspendedByBilling: true, plan: { interval: 'MONTHLY' } },
    });
    await billing.svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(billing.vendors.unsuspend).toHaveBeenCalledWith('v1');

    const plain = setup();
    await plain.svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(plain.vendors.unsuspend).not.toHaveBeenCalled();
  });

  it('a manually suspended vendor (no billing flag) is never unsuspended by a payment', async () => {
    const { svc, vendors } = setup({ vendorActive: false });
    await svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(vendors.unsuspend).not.toHaveBeenCalled();
  });

  it('audits with the actor and invalidates the limits cache', async () => {
    const { svc, audit, planLimits } = setup();
    await svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVOICE_PAYMENT', userId: 'admin1', vendorId: 'v1' }));
    expect(planLimits.invalidate).toHaveBeenCalledWith('v1');
  });

  it('does not touch a CANCELLED subscription', async () => {
    const { svc, tx } = setup({
      sub: { id: 's1', vendorId: 'v1', status: 'CANCELLED', currentPeriodEnd: NOW, suspendedByBilling: false, plan: { interval: 'MONTHLY' } },
    });
    await svc.recordPayment('i1', pay(1000), actor, NOW);
    expect(tx.vendorSubscription.update).not.toHaveBeenCalled();
  });
});

describe('InvoiceService.void', () => {
  it('409 when payments exist', async () => {
    const { svc, prisma } = setup();
    (prisma as any).invoice.findUnique = jest.fn(async () => ({ id: 'i1', vendorId: 'v1', status: 'OPEN', payments: [{ id: 'p' }] }));
    await expect(svc.void('i1', { reason: 'oops' }, actor, NOW)).rejects.toThrow(/payments/);
  });

  it('voids an unpaid invoice with a reason', async () => {
    const { svc, prisma } = setup();
    (prisma as any).invoice.findUnique = jest.fn(async () => ({ id: 'i1', vendorId: 'v1', status: 'OPEN', payments: [] }));
    (prisma as any).invoice.update = jest.fn(async ({ data }: any) => data);
    const res = await svc.void('i1', { reason: 'oops' }, actor, NOW);
    expect(res).toMatchObject({ status: 'VOID', voidedAt: NOW, voidReason: 'oops' });
  });
});

describe('InvoiceService.createRenewalInvoice', () => {
  const sub = {
    id: 's1', vendorId: 'v1', currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    plan: { price: D(1000), currency: 'PKR', interval: 'MONTHLY', name: 'Starter' },
  };

  it('creates an OPEN invoice for the next period', async () => {
    const { svc, tx } = setup();
    const inv = await svc.createRenewalInvoice(sub as never);
    expect(inv).toBeTruthy();
    expect(tx.invoice.create.mock.calls[0][0].data).toMatchObject({
      status: 'OPEN', subscriptionId: 's1', periodStart: sub.currentPeriodEnd, periodEnd: new Date('2027-01-01T00:00:00.000Z'),
    });
  });

  it('swallows the unique-violation so the sweep is idempotent', async () => {
    const { svc, tx } = setup();
    tx.invoice.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(svc.createRenewalInvoice(sub as never)).resolves.toBeNull();
  });
});
