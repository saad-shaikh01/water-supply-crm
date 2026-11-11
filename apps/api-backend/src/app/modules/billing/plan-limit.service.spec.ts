import { ForbiddenException } from '@nestjs/common';
import { PlanLimitService, planLimitsKey } from './plan-limit.service';

function setup(sub: unknown, counts = { customers: 0, drivers: 0, vans: 0 }) {
  const store = new Map<string, unknown>();
  const prisma = {
    vendorSubscription: { findUnique: jest.fn(async () => sub) },
    customer: { count: jest.fn(async () => counts.customers) },
    user: { count: jest.fn(async () => counts.drivers) },
    van: { count: jest.fn(async () => counts.vans) },
  };
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  const svc = new PlanLimitService(prisma as never, cache as never);
  return { svc, prisma, cache, store };
}

const sub = (over: Record<string, unknown> = {}, plan: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  overrideMaxCustomers: null,
  overrideMaxDrivers: null,
  overrideMaxVans: null,
  plan: { name: 'Starter', maxCustomers: 100, maxDrivers: 5, maxVans: 2, ...plan },
  ...over,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse() as Record<string, unknown>;
  }
  return null;
};

describe('PlanLimitService.assertCanCreate', () => {
  it('allows vendors without a subscription (grandfathered / unlimited)', async () => {
    const { svc, prisma } = setup(null);
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
    expect(prisma.customer.count).not.toHaveBeenCalled();
  });

  it('treats a null limit as unlimited', async () => {
    const { svc } = setup(sub({}, { maxCustomers: null }), { customers: 99999, drivers: 0, vans: 0 });
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
  });

  it('allows used 99 / limit 100 / adding 1', async () => {
    const { svc } = setup(sub(), { customers: 99, drivers: 0, vans: 0 });
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
  });

  it('rejects at the limit with PLAN_LIMIT_REACHED and details', async () => {
    const { svc } = setup(sub(), { customers: 100, drivers: 0, vans: 0 });
    const body = await code(svc.assertCanCreate('v1', 'CUSTOMER'));
    expect(body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', resource: 'CUSTOMER', limit: 100, used: 100, planName: 'Starter' });
  });

  it('enforces driver and van limits', async () => {
    const { svc } = setup(sub(), { customers: 0, drivers: 5, vans: 2 });
    expect(await code(svc.assertCanCreate('v1', 'DRIVER'))).toMatchObject({ code: 'PLAN_LIMIT_REACHED', resource: 'DRIVER', limit: 5 });
    expect(await code(svc.assertCanCreate('v1', 'VAN'))).toMatchObject({ code: 'PLAN_LIMIT_REACHED', resource: 'VAN', limit: 2 });
  });

  it('per-vendor override beats the plan value', async () => {
    const { svc } = setup(sub({ overrideMaxCustomers: 150 }), { customers: 120, drivers: 0, vans: 0 });
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
    const { svc: tight } = setup(sub({ overrideMaxCustomers: 10 }), { customers: 10, drivers: 0, vans: 0 });
    expect(await code(tight.assertCanCreate('v1', 'CUSTOMER'))).toMatchObject({ limit: 10 });
  });

  it('PAST_DUE and CANCELLED block creation with SUBSCRIPTION_INACTIVE', async () => {
    for (const status of ['PAST_DUE', 'CANCELLED']) {
      const { svc } = setup(sub({ status }));
      expect(await code(svc.assertCanCreate('v1', 'VAN'))).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE', status });
    }
  });

  it('TRIAL is treated like ACTIVE', async () => {
    const { svc } = setup(sub({ status: 'TRIAL' }));
    await expect(svc.assertCanCreate('v1', 'VAN')).resolves.toBeUndefined();
  });

  it('rejects a batch that crosses the limit', async () => {
    const { svc } = setup(sub(), { customers: 60, drivers: 0, vans: 0 });
    expect(await code(svc.assertCanCreate('v1', 'CUSTOMER', 50))).toMatchObject({ code: 'PLAN_LIMIT_REACHED', used: 60 });
    await expect(svc.assertCanCreate('v1', 'CUSTOMER', 40)).resolves.toBeUndefined();
  });

  it('caches limits (second call skips the DB) and invalidation forces a re-read', async () => {
    const { svc, prisma, store } = setup(sub());
    await svc.assertCanCreate('v1', 'CUSTOMER');
    await svc.assertCanCreate('v1', 'CUSTOMER');
    expect(prisma.vendorSubscription.findUnique).toHaveBeenCalledTimes(1);
    expect(store.has(planLimitsKey('v1'))).toBe(true);
    await svc.invalidate('v1');
    await svc.assertCanCreate('v1', 'CUSTOMER');
    expect(prisma.vendorSubscription.findUnique).toHaveBeenCalledTimes(2);
  });

  it('caches "no subscription" too', async () => {
    const { svc, prisma } = setup(null);
    await svc.assertCanCreate('v1', 'CUSTOMER');
    await svc.assertCanCreate('v1', 'CUSTOMER');
    expect(prisma.vendorSubscription.findUnique).toHaveBeenCalledTimes(1);
  });

  it('fails open when the limit lookup throws', async () => {
    const { svc, prisma } = setup(sub());
    prisma.vendorSubscription.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
  });

  it('fails open when the usage count throws', async () => {
    const { svc, prisma } = setup(sub());
    prisma.customer.count.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.assertCanCreate('v1', 'CUSTOMER')).resolves.toBeUndefined();
  });

  it('ignores calls without a vendor (platform users)', async () => {
    const { svc, prisma } = setup(sub());
    await svc.assertCanCreate(undefined, 'CUSTOMER');
    expect(prisma.vendorSubscription.findUnique).not.toHaveBeenCalled();
  });
});
