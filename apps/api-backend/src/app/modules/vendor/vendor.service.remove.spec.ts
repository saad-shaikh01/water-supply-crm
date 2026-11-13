import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VendorService } from './vendor.service';

const actor = { userId: 's1', name: 'Super' } as never;

function make(opts: { vendor?: unknown; blockerCounts?: Record<string, number>; txError?: unknown } = {}) {
  const tx: any = new Proxy(
    {},
    {
      get: (_t, model: string) => ({
        deleteMany: jest.fn(async () => ({ count: 0 })),
        delete: jest.fn(async () => {
          if (opts.txError && model === 'vendor') throw opts.txError;
          return {};
        }),
      }),
    },
  );
  const prisma: any = {
    vendor: {
      findUnique: jest.fn(async () =>
        'vendor' in opts ? opts.vendor : { id: 'v1', name: 'V', _count: { transactions: 0, customers: 0 } },
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  for (const m of (VendorService as any).DELETE_BLOCKER_MODELS as string[]) {
    prisma[m] = { count: jest.fn(async () => opts.blockerCounts?.[m] ?? 0) };
  }
  const cache = { del: jest.fn(async () => undefined), invalidatePlatformDashboard: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new VendorService(prisma, cache as never, audit as never, {} as never);
  return { svc, prisma, cache, audit };
}

describe('VendorService.remove', () => {
  it('deletes an empty vendor in a transaction, clears cache and audits with actor', async () => {
    const { svc, prisma, cache, audit } = make();
    await expect(svc.remove('v1', actor)).resolves.toEqual({
      message: 'Vendor and all associated data deleted permanently',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', userId: 's1', entityId: 'v1' }));
  });

  it('404s an unknown vendor', async () => {
    const { svc } = make({ vendor: null });
    await expect(svc.remove('nope', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still refuses (400) when transactions exist', async () => {
    const { svc, prisma } = make({ vendor: { id: 'v1', name: 'V', _count: { transactions: 2, customers: 0 } } });
    await expect(svc.remove('v1', actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('REGRESSION: refuses with 409 listing blockers (expenses) instead of a 500 from user.deleteMany', async () => {
    const { svc, prisma, audit } = make({ blockerCounts: { expense: 3, staffLedgerEntry: 1 } });
    const err: any = await svc.remove('v1', actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().blockers).toEqual([
      { entity: 'expense', count: 3 },
      { entity: 'staffLedgerEntry', count: 1 },
    ]);
    expect(err.message).toContain('expense (3)');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('maps an unforeseen FK violation (P2003) to 409, not 500, and does not audit', async () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: 'x',
      meta: { constraint: 'Foo_createdById_fkey' },
    });
    const { svc, cache, audit } = make({ txError: p2003 });
    const err: any = await svc.remove('v1', actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('Foo_createdById_fkey');
    expect(cache.del).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rethrows other errors untouched', async () => {
    const boom = new Error('boom');
    const { svc } = make({ txError: boom });
    await expect(svc.remove('v1', actor)).rejects.toBe(boom);
  });
});
