import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

const actor = { userId: 'admin1', name: 'Super', role: 'SUPER_ADMIN', email: 'a', vendorId: null, customerId: null } as never;
const NOW = new Date('2026-11-12T00:00:00.000Z');

function setup(opts: { existing?: unknown; plan?: unknown; usage?: { customers: number; drivers: number; vans: number } } = {}) {
  const plan = opts.plan ?? {
    id: 'p1', name: 'Starter', isActive: true, trialDays: 14, interval: 'MONTHLY', price: 1000,
    maxCustomers: 5, maxDrivers: 2, maxVans: 1,
  };
  const prisma = {
    vendor: { findUnique: jest.fn(async () => ({ id: 'v1', name: 'V' })) },
    plan: { findUnique: jest.fn(async () => plan) },
    vendorSubscription: {
      findUnique: jest.fn(async () => opts.existing ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 's1', ...data, plan })),
      update: jest.fn(async ({ data }: any) => ({ id: 's1', ...(opts.existing as object), ...data, plan })),
    },
  };
  const audit = { log: jest.fn() };
  const planLimits = {
    invalidate: jest.fn(),
    getUsage: jest.fn(async () => opts.usage ?? { customers: 0, drivers: 0, vans: 0 }),
  };
  const svc = new SubscriptionService(prisma as never, audit as never, planLimits as never);
  return { svc, prisma, audit, planLimits };
}

describe('SubscriptionService.assign', () => {
  it('starts a TRIAL with trialEndsAt = now + trialDays on first assignment', async () => {
    const { svc, prisma, planLimits, audit } = setup();
    const res = await svc.assign('v1', { planId: 'p1' }, actor, NOW);
    const data = prisma.vendorSubscription.create.mock.calls[0][0].data;
    expect(data.status).toBe('TRIAL');
    expect(data.trialEndsAt).toEqual(new Date('2026-11-26T00:00:00.000Z'));
    expect(data.currentPeriodEnd).toEqual(data.trialEndsAt);
    expect(res.warnings).toEqual([]);
    expect(planLimits.invalidate).toHaveBeenCalledWith('v1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin1', vendorId: 'v1', action: 'SUBSCRIPTION_ASSIGN' }));
  });

  it('goes straight to ACTIVE when the plan has no trial', async () => {
    const { svc, prisma } = setup({
      plan: { id: 'p1', name: 'Pro', isActive: true, trialDays: 0, interval: 'MONTHLY', price: 1, maxCustomers: null, maxDrivers: null, maxVans: null },
    });
    await svc.assign('v1', { planId: 'p1' }, actor, NOW);
    const data = prisma.vendorSubscription.create.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect(data.currentPeriodEnd).toEqual(new Date('2026-12-12T00:00:00.000Z'));
  });

  it('a second assignment updates instead of creating a duplicate', async () => {
    const existing = { id: 's1', vendorId: 'v1', planId: 'p0', status: 'ACTIVE' };
    const { svc, prisma } = setup({ existing });
    await svc.assign('v1', { planId: 'p1' }, actor, NOW);
    expect(prisma.vendorSubscription.create).not.toHaveBeenCalled();
    expect(prisma.vendorSubscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.vendorSubscription.update.mock.calls[0][0].data.planId).toBe('p1');
  });

  it('downgrade below usage returns a warning, never an error', async () => {
    const existing = { id: 's1', vendorId: 'v1', planId: 'p0', status: 'ACTIVE' };
    const { svc } = setup({ existing, usage: { customers: 50, drivers: 0, vans: 0 } });
    const res = await svc.assign('v1', { planId: 'p1' }, actor, NOW);
    expect(res.warnings).toEqual(['USAGE_EXCEEDS_LIMIT']);
  });

  it('effective limits merge overrides over plan values', async () => {
    const { svc } = setup();
    const res = await svc.assign('v1', { planId: 'p1', overrides: { maxCustomers: 500, maxVans: null } }, actor, NOW);
    expect(res.limits).toEqual({ maxCustomers: 500, maxDrivers: 2, maxVans: 1 });
  });

  it('refuses to newly assign an inactive plan', async () => {
    const { svc } = setup({ plan: { id: 'p1', name: 'Old', isActive: false, trialDays: 0, interval: 'MONTHLY' } });
    await expect(svc.assign('v1', { planId: 'p1' }, actor, NOW)).rejects.toThrow(/inactive/);
  });

  it('404 for unknown plan', async () => {
    const { svc, prisma } = setup();
    prisma.plan.findUnique.mockResolvedValueOnce(null as never);
    await expect(svc.assign('v1', { planId: 'zz' }, actor, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubscriptionService cancel / reactivate', () => {
  it('cancel sets status, cancelledAt and reason, and invalidates limits', async () => {
    const { svc, prisma, planLimits, audit } = setup({ existing: { id: 's1', vendorId: 'v1', status: 'ACTIVE' } });
    await svc.cancel('v1', { reason: 'left us' }, actor, NOW);
    expect(prisma.vendorSubscription.update.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED', cancelledAt: NOW, cancelReason: 'left us',
    });
    expect(planLimits.invalidate).toHaveBeenCalledWith('v1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CANCEL', userId: 'admin1' }));
  });

  it('cancelling twice conflicts', async () => {
    const { svc } = setup({ existing: { id: 's1', vendorId: 'v1', status: 'CANCELLED' } });
    await expect(svc.cancel('v1', { reason: 'x' }, actor, NOW)).rejects.toThrow(/already cancelled/);
  });

  it('reactivate restores ACTIVE with a fresh period', async () => {
    const { svc, prisma } = setup({ existing: { id: 's1', vendorId: 'v1', status: 'CANCELLED', plan: { interval: 'MONTHLY' } } });
    await svc.reactivate('v1', actor, NOW);
    expect(prisma.vendorSubscription.update.mock.calls[0][0].data).toMatchObject({
      status: 'ACTIVE', cancelledAt: null, currentPeriodStart: NOW, currentPeriodEnd: new Date('2026-12-12T00:00:00.000Z'),
    });
  });
});
