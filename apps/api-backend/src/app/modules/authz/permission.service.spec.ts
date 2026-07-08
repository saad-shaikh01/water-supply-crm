import { PermissionService } from './permission.service';

type AnyFn = (...args: unknown[]) => unknown;

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
}

function makePrisma(user: unknown, usersOfRole: { id: string }[] = []) {
  return {
    user: {
      findUnique: jest.fn(async () => user),
      findMany: jest.fn(async () => usersOfRole),
    },
  };
}

function service(prisma: unknown, cache: unknown) {
  return new PermissionService(prisma as never, cache as never);
}

describe('PermissionService', () => {
  it('resolves role permissions + overrides via the engine', async () => {
    const user = {
      roleRef: { permissions: [{ permission: 'customers:*' }] },
      permissionOverrides: [{ permission: 'customers:delete', effect: 'DENY', expiresAt: null }],
    };
    const svc = service(makePrisma(user), makeCache());
    const perms = await svc.getEffectivePermissions('u1');

    expect(perms).toContain('customers:update');
    expect(perms).not.toContain('customers:delete'); // DENY wins
  });

  it('returns [] for an unknown user', async () => {
    const svc = service(makePrisma(null), makeCache());
    expect(await svc.getEffectivePermissions('missing')).toEqual([]);
  });

  it('caches the resolved set and reuses it on the next call', async () => {
    const user = { roleRef: { permissions: [{ permission: 'orders:view' }] }, permissionOverrides: [] };
    const prisma = makePrisma(user);
    const cache = makeCache();
    const svc = service(prisma, cache);

    await svc.getEffectivePermissions('u1');
    await svc.getEffectivePermissions('u1');

    expect((prisma.user.findUnique as unknown as jest.Mock)).toHaveBeenCalledTimes(1); // 2nd from cache
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('can / canAny / canAll honor the effective set', async () => {
    const user = { roleRef: { permissions: [{ permission: 'orders:view' }] }, permissionOverrides: [] };
    const svc = service(makePrisma(user), makeCache());

    expect(await svc.can('u1', 'orders:view')).toBe(true);
    expect(await svc.can('u1', 'orders:approve')).toBe(false);
    expect(await svc.canAny('u1', ['orders:approve', 'orders:view'])).toBe(true);
    expect(await svc.canAll('u1', ['orders:view', 'orders:approve'])).toBe(false);
  });

  it('a super-admin wildcard role grants everything', async () => {
    const user = { roleRef: { permissions: [{ permission: '*' }] }, permissionOverrides: [] };
    const svc = service(makePrisma(user), makeCache());
    expect(await svc.can('u1', 'audit_logs:view')).toBe(true);
    expect(await svc.can('u1', 'payments:approve')).toBe(true);
  });

  it('invalidateUser deletes the cache key', async () => {
    const cache = makeCache();
    const svc = service(makePrisma(null), cache);
    await svc.invalidateUser('u1');
    expect(cache.del).toHaveBeenCalledWith('authz:perms:u1');
  });

  it('invalidateRole fans out to all users of the role', async () => {
    const cache = makeCache();
    const prisma = makePrisma(null, [{ id: 'a' }, { id: 'b' }]);
    const svc = service(prisma, cache);
    await svc.invalidateRole('role1');
    expect(cache.del).toHaveBeenCalledWith('authz:perms:a');
    expect(cache.del).toHaveBeenCalledWith('authz:perms:b');
  });
});
