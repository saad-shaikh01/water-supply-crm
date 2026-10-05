import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PermissionService } from '../authz/permission.service';
import { UserService, userInactiveKey, USER_INACTIVE_FLAG_TTL_MS } from '../user/user.service';

/**
 * Regression suite for audit finding H1: a deactivated user could still log in (login never checked
 * `isActive`), kept using an already-issued JWT for up to a day, and `PermissionService` kept
 * resolving their permissions.
 */
function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
    invalidateVendorEntity: jest.fn(),
  };
}

describe('AuthService.validateUser — inactive users', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('Password123!', 4);
  });

  const makeAuth = (user: unknown) => {
    const cache = makeCache();
    const users = { findByIdentifier: jest.fn(async () => user) };
    return { auth: new AuthService(users as never, {} as never, {} as never, cache as never), cache };
  };

  it('rejects login for a deactivated user even with the CORRECT password', async () => {
    const { auth } = makeAuth({ id: 'u1', password: hash, isActive: false });
    await expect(auth.validateUser('a@x.test', 'Password123!')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.validateUser('a@x.test', 'Password123!')).rejects.toThrow(/deactivated/i);
  });

  it('does not reveal deactivation to someone with the wrong password (normal failed login)', async () => {
    const { auth, cache } = makeAuth({ id: 'u1', password: hash, isActive: false });
    await expect(auth.validateUser('a@x.test', 'wrong-password')).resolves.toBeNull();
    expect(cache.store.get('auth:fail:a@x.test')).toBe(1);
  });

  it('still logs an active user in', async () => {
    const { auth } = makeAuth({ id: 'u1', password: hash, isActive: true, email: 'a@x.test' });
    const result = await auth.validateUser('a@x.test', 'Password123!');
    expect(result).toMatchObject({ id: 'u1' });
    expect(result).not.toHaveProperty('password');
  });
});

describe('JwtStrategy.validate — tokens issued before deactivation', () => {
  const payload = { sub: 'u1', email: 'a@x.test', name: 'A', role: 'STAFF', vendorId: 'v1' };

  it('rejects a still-valid JWT once the user has been deactivated', async () => {
    const cache = makeCache();
    cache.store.set(userInactiveKey('u1'), true);
    const strategy = new JwtStrategy(cache as never);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the JWT of an active user, and the flag is per user', async () => {
    const cache = makeCache();
    cache.store.set(userInactiveKey('someone-else'), true);
    const strategy = new JwtStrategy(cache as never);
    await expect(strategy.validate(payload)).resolves.toMatchObject({ userId: 'u1', vendorId: 'v1' });
  });
});

describe('PermissionService — inactive users hold no permissions', () => {
  const user = (isActive: boolean) => ({
    isActive,
    roleRef: { permissions: [{ permission: 'customers:*' }] },
    permissionOverrides: [],
  });
  const svc = (u: unknown) =>
    new PermissionService({ user: { findUnique: jest.fn(async () => u) } } as never, makeCache() as never);

  it('resolves an empty set for an inactive user (backstop if the Redis flag is lost)', async () => {
    await expect(svc(user(false)).getEffectivePermissions('u1')).resolves.toEqual([]);
  });

  it('still resolves the role for an active user', async () => {
    await expect(svc(user(true)).getEffectivePermissions('u1')).resolves.toContain('customers:update');
  });
});

describe('UserService deactivate / reactivate', () => {
  function makeUsers() {
    const cache = makeCache();
    const tx = { user: { update: jest.fn(async ({ data }: { data: object }) => ({ id: 'u1', ...data })) } };
    const prisma = {
      user: {
        findFirst: jest.fn(async () => ({ id: 'u1', vendorId: 'v1' })),
        update: jest.fn(async ({ data }: { data: object }) => ({ id: 'u1', ...data })),
      },
      van: { updateMany: jest.fn() },
      vanDefaultCrew: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    };
    const permissions = { invalidateUser: jest.fn() };
    const policy = { assertNotLastAdmin: jest.fn() };
    const svc = new UserService(
      prisma as never,
      cache as never,
      { log: jest.fn() } as never,
      permissions as never,
      policy as never,
    );
    return { svc, cache, permissions };
  }

  it('deactivate flags the user so live JWTs stop working, for longer than a token lives', async () => {
    const { svc, cache, permissions } = makeUsers();
    await svc.deactivate('v1', 'u1');
    expect(cache.store.get(userInactiveKey('u1'))).toBe(true);
    expect(cache.set).toHaveBeenCalledWith(userInactiveKey('u1'), true, USER_INACTIVE_FLAG_TTL_MS);
    expect(USER_INACTIVE_FLAG_TTL_MS).toBeGreaterThan(24 * 60 * 60 * 1000); // access-token lifetime is 1d
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u1');
  });

  it('reactivate clears the flag and the cached (empty) permission set', async () => {
    const { svc, cache, permissions } = makeUsers();
    cache.store.set(userInactiveKey('u1'), true);
    await svc.reactivate('v1', 'u1');
    expect(cache.store.has(userInactiveKey('u1'))).toBe(false);
    expect(permissions.invalidateUser).toHaveBeenCalledWith('u1');
  });
});
