import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { authExtraDeps } from './testing/auth-deps';

/** In-memory stand-in for the Redis-backed CacheInvalidationService. */
function build(users: Record<string, any> = {}) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  const userService = {
    findById: jest.fn(async (id: string) => users[id] ?? null),
    findByIdentifier: jest.fn(async (i: string) => Object.values(users).find((u: any) => u.email === i) ?? null),
  };
  const jwt = { sign: jest.fn(() => 'jwt') };
  const svc = new AuthService(userService as never, jwt as never, {} as never, cache as never, ...(authExtraDeps() as [never, never, never, never]));
  return { svc, store, cache };
}

const admin = { id: 'u1', email: 'sa@x.com', name: 'SA', role: 'SUPER_ADMIN', vendorId: null, isActive: true };

describe('AuthService refresh/logout', () => {
  it('login stores a refresh token that refresh can rotate', async () => {
    const { svc, store } = build({ u1: admin });
    const { refresh_token } = (await svc.login(admin) as any);
    expect(store.has(`auth:refresh:${refresh_token}`)).toBe(true);
    const next = await svc.refreshTokens(refresh_token);
    expect(next.refresh_token).not.toBe(refresh_token);
    expect(store.has(`auth:refresh:${refresh_token}`)).toBe(false);
  });

  it('logout deletes the refresh key', async () => {
    const { svc, store, cache } = build({ u1: admin });
    const { refresh_token } = (await svc.login(admin) as any);
    await svc.logout(refresh_token);
    expect(cache.del).toHaveBeenCalledWith(`auth:refresh:${refresh_token}`);
    expect(store.has(`auth:refresh:${refresh_token}`)).toBe(false);
  });

  it('refresh after logout fails with 401', async () => {
    const { svc } = build({ u1: admin });
    const { refresh_token } = (await svc.login(admin) as any);
    await svc.logout(refresh_token);
    await expect(svc.refreshTokens(refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a refresh token cannot be replayed after rotation', async () => {
    const { svc } = build({ u1: admin });
    const { refresh_token } = (await svc.login(admin) as any);
    await svc.refreshTokens(refresh_token);
    await expect(svc.refreshTokens(refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.validateUser suspended vendor', () => {
  it('refuses a user of a suspended vendor with the correct password', async () => {
    const password = await bcrypt.hash('Password123!', 4);
    const { svc } = build({
      u2: { id: 'u2', email: 'va@x.com', password, isActive: true, vendor: { id: 'v1', isActive: false } },
    });
    await expect(svc.validateUser('va@x.com', 'Password123!')).rejects.toThrow(/suspended/i);
  });
});
