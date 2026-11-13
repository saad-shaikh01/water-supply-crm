import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlanService } from './plan.service';
import { CreatePlanDto } from './dto/plan.dto';

const actor = { userId: 'admin1', name: 'Super', role: 'SUPER_ADMIN', email: 'a', vendorId: null, customerId: null } as never;

function setup(over: Record<string, unknown> = {}) {
  const prisma = {
    plan: {
      create: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
      findUnique: jest.fn(async () => ({ id: 'p1', _count: { subscriptions: 0 } })),
      delete: jest.fn(),
      ...over,
    },
    vendorSubscription: { findMany: jest.fn(async () => []) },
  };
  const audit = { log: jest.fn() };
  const planLimits = { invalidate: jest.fn(), getUsage: jest.fn() };
  return { svc: new PlanService(prisma as never, audit as never, planLimits as never), prisma, audit };
}

describe('PlanService', () => {
  it('409 on duplicate name', async () => {
    const { svc } = setup({
      create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })),
    });
    await expect(svc.create({ name: 'Starter', price: 1, interval: 'MONTHLY' } as never, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks deleting a plan that subscriptions reference', async () => {
    const { svc, prisma } = setup({ findUnique: jest.fn(async () => ({ id: 'p1', _count: { subscriptions: 2 } })) });
    await expect(svc.remove('p1', actor)).rejects.toThrow(/Deactivate/);
    expect(prisma.plan.delete).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced plan and audits it', async () => {
    const { svc, prisma, audit } = setup();
    await svc.remove('p1', actor);
    expect(prisma.plan.delete).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', userId: 'admin1' }));
  });

  it('update reports affectedVendors', async () => {
    const { svc } = setup();
    await expect(svc.update('p1', { maxVans: 1 }, actor)).resolves.toMatchObject({ affectedVendors: 0 });
  });
});

describe('CreatePlanDto validation', () => {
  const errs = async (o: object) => validate(plainToInstance(CreatePlanDto, o));
  const ok = { name: 'Starter', price: 100, interval: 'MONTHLY' };

  it('accepts null limits (unlimited)', async () => {
    expect(await errs({ ...ok, maxCustomers: null, maxDrivers: null, maxVans: null })).toHaveLength(0);
  });
  it('rejects negative price and limits', async () => {
    expect((await errs({ ...ok, price: -1 })).length).toBeGreaterThan(0);
    expect((await errs({ ...ok, maxCustomers: -5 })).length).toBeGreaterThan(0);
    expect((await errs({ ...ok, maxVans: -1 })).length).toBeGreaterThan(0);
  });
  it('rejects a bad interval / empty name', async () => {
    expect((await errs({ ...ok, interval: 'WEEKLY' })).length).toBeGreaterThan(0);
    expect((await errs({ ...ok, name: '' })).length).toBeGreaterThan(0);
  });
});
