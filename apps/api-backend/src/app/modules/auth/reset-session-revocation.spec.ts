import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthSessionService } from './session/auth-session.service';
import { authExtraDeps } from './testing/auth-deps';

/** AuthService.revokeUserSessions: tokens issued before the revocation are void, later ones work. */
function memoryCache() {
  const m = new Map<string, unknown>();
  return {
    get: jest.fn(async (k: string) => m.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void m.set(k, v)),
    del: jest.fn(async (k: string) => void m.delete(k)),
  };
}

describe('session revocation (admin password reset)', () => {
  const user = { id: 'u1', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN', vendorId: 'v1', isActive: true };
  let cache: ReturnType<typeof memoryCache>;
  let auth: AuthService;
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-test-secret-test-secret-123';
    cache = memoryCache();
    const prisma = { authSession: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) } };
    const sessions = new AuthSessionService(prisma as never, cache as never);
    auth = new AuthService({ findById: jest.fn(async () => user) } as never, new JwtService({ secret: 'x' }), {} as never, cache as never, ...(authExtraDeps({ sessions }) as [never, never, never, never]));
    strategy = new JwtStrategy(cache as never);
  });
  afterEach(() => jest.useRealTimers());

  it('refresh token issued before the reset is rejected, one issued after works', async () => {
    const before: any = await auth.login(user);
    await new Promise((r) => setTimeout(r, 5));
    await auth.revokeUserSessions('u1');
    await new Promise((r) => setTimeout(r, 5));
    await expect(auth.refreshTokens(before.refresh_token)).rejects.toBeInstanceOf(UnauthorizedException);
    const after: any = await auth.login(user);
    await expect(auth.refreshTokens(after.refresh_token)).resolves.toHaveProperty('access_token');
  });

  it('access token issued before the reset is rejected by JwtStrategy, a later one passes', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = (iat: number) => ({ sub: 'u1', email: 'a@x.com', name: 'A', role: 'VENDOR_ADMIN', vendorId: 'v1', iat });
    await expect(strategy.validate(payload(nowSec - 100))).resolves.toMatchObject({ userId: 'u1' }); // no marker yet
    await auth.revokeUserSessions('u1');
    await expect(strategy.validate(payload(nowSec - 100))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(payload(nowSec + 2))).resolves.toMatchObject({ userId: 'u1' });
  });

  it('other users are unaffected', async () => {
    await auth.revokeUserSessions('u1');
    await expect(strategy.validate({ sub: 'u2', role: 'VENDOR_ADMIN', iat: 1 })).resolves.toMatchObject({ userId: 'u2' });
  });
});
