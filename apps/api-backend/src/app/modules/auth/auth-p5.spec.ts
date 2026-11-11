import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { getJwtSecret } from './jwt-secret';
import { sessionRevokedKey, userRevokedBeforeKey } from './session/auth-session.service';

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
}

const derived2faSecret = () => createHmac('sha256', getJwtSecret()).update('2fa').digest('hex');

describe('AuthService (phase 5: lockout, sessions, 2FA login flow)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('Password123!', 4);
  });

  function setup(opts: { user?: any; policy?: Partial<Record<string, unknown>>; twoFactorEnabled?: boolean } = {}) {
    const cache = makeCache();
    const jwt = new JwtService({ secret: getJwtSecret(), signOptions: { expiresIn: '1d' } });
    const user = opts.user ?? null;
    const users = {
      findByIdentifier: jest.fn(async () => user),
      findById: jest.fn(async () => user),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const sessions = {
      create: jest.fn(async () => ({ id: 'sess-1' })),
      touch: jest.fn(async () => undefined),
      assertActive: jest.fn(async () => undefined),
      revoke: jest.fn(async () => undefined),
      revokeAllUserTokens: jest.fn(async () => undefined),
      userTokensRevokedSince: jest.fn(async () => false),
    };
    const twoFactor = {
      isEnabled: jest.fn(async () => !!opts.twoFactorEnabled),
      verifyLogin: jest.fn(async () => ({ usedRecoveryCode: false })),
    };
    const policy = {
      get: jest.fn(async () => ({
        loginMaxAttempts: 5,
        loginLockMinutes: 15,
        require2faForSuperAdmin: false,
        ...opts.policy,
      })),
    };
    const auth = new AuthService(
      users as never,
      jwt,
      {} as never,
      cache as never,
      audit as never,
      sessions as never,
      twoFactor as never,
      policy as never,
    );
    return { auth, cache, jwt, users, audit, sessions, twoFactor, policy };
  }

  const baseUser = (role: string, extra: Record<string, unknown> = {}) => ({
    id: `u-${role}`,
    email: `${role.toLowerCase()}@x.test`,
    name: role,
    role,
    isActive: true,
    vendorId: role === 'SUPER_ADMIN' ? null : 'v1',
    password: hash,
    ...extra,
  });

  describe('non-SUPER_ADMIN login is unchanged (regression)', () => {
    it.each(['VENDOR_ADMIN', 'STAFF', 'DRIVER', 'CUSTOMER'])('%s gets the legacy response shape', async (role) => {
      const extra = role === 'CUSTOMER' ? { customer: { id: 'c1' } } : {};
      const { auth, sessions, twoFactor, jwt, cache } = setup({ twoFactorEnabled: true, policy: { require2faForSuperAdmin: true } });
      const result: any = await auth.login(baseUser(role, extra), { ip: '1.1.1.1', userAgent: 'jest' });

      expect(Object.keys(result).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'user']);
      const expectedUserKeys = ['email', 'id', 'name', 'role', 'vendorId', ...(role === 'CUSTOMER' ? ['customerId'] : [])];
      expect(Object.keys(result.user).sort()).toEqual(expectedUserKeys.sort());
      expect(result.user).not.toHaveProperty('mustChangePassword');
      expect(jwt.decode(result.access_token)).not.toHaveProperty('sid');
      expect(sessions.create).not.toHaveBeenCalled();
      expect(twoFactor.isEnabled).not.toHaveBeenCalled();
      expect(cache.store.get(`auth:refresh:${result.refresh_token}`)).toEqual({
        userId: `u-${role}`,
        iat: expect.any(Number),
      });
    });
  });

  describe('SUPER_ADMIN login', () => {
    it('with 2FA enabled returns a challenge and NO access token; challenge cannot authenticate', async () => {
      const { auth, jwt, sessions } = setup({ twoFactorEnabled: true });
      const res: any = await auth.login(baseUser('SUPER_ADMIN'));
      expect(res.requires2fa).toBe(true);
      expect(res.challengeToken).toEqual(expect.any(String));
      expect(res).not.toHaveProperty('access_token');
      expect(res).not.toHaveProperty('refresh_token');
      expect(sessions.create).not.toHaveBeenCalled();
      // not verifiable with the access-token secret => JwtStrategy would reject it
      expect(() => jwt.verify(res.challengeToken)).toThrow();
    });

    it('without 2FA and enforcement off gets tokens with a sid and a session', async () => {
      const { auth, jwt, sessions, cache } = setup();
      const res: any = await auth.login(baseUser('SUPER_ADMIN', { mustChangePassword: true }), { ip: '9.9.9.9', userAgent: 'UA' });
      expect(sessions.create).toHaveBeenCalledWith('u-SUPER_ADMIN', { ip: '9.9.9.9', userAgent: 'UA' });
      expect((jwt.decode(res.access_token) as any).sid).toBe('sess-1');
      expect(res.user.mustChangePassword).toBe(true);
      expect(cache.store.get(`auth:refresh:${res.refresh_token}`)).toMatchObject({ sessionId: 'sess-1' });
    });

    it('without 2FA and enforcement on returns only an enrollment token', async () => {
      const { auth } = setup({ policy: { require2faForSuperAdmin: true } });
      const res: any = await auth.login(baseUser('SUPER_ADMIN'));
      expect(res.requires2faEnrollment).toBe(true);
      expect(res.enrollmentToken).toEqual(expect.any(String));
      expect(res).not.toHaveProperty('access_token');
    });
  });

  describe('verifyTwoFactorLogin', () => {
    const admin = baseUser('SUPER_ADMIN');
    const challenge = (jwt: JwtService, opts: Record<string, unknown> = {}, type = '2fa-challenge') =>
      jwt.sign({ sub: admin.id, type }, { secret: derived2faSecret(), expiresIn: '5m', ...opts });

    it('issues tokens after a valid code and audits LOGIN_2FA_OK', async () => {
      const { auth, jwt, audit } = setup({ user: admin, twoFactorEnabled: true });
      const res: any = await auth.verifyTwoFactorLogin({ challengeToken: challenge(jwt), code: '123456' }, { ip: '2.2.2.2' });
      expect(res.access_token).toEqual(expect.any(String));
      expect(res.usedRecoveryCode).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_2FA_OK', userId: admin.id }));
    });

    it('passes through recovery-code info', async () => {
      const { auth, jwt, twoFactor } = setup({ user: admin });
      twoFactor.verifyLogin.mockResolvedValue({ usedRecoveryCode: true, remainingRecoveryCodes: 9 } as never);
      const res: any = await auth.verifyTwoFactorLogin({ challengeToken: challenge(jwt), recoveryCode: 'AAAAA-BBBBB' });
      expect(res).toMatchObject({ usedRecoveryCode: true, remainingRecoveryCodes: 9 });
    });

    it('rejects an expired challenge, a wrong-type token and a plain access token', async () => {
      const { auth, jwt } = setup({ user: admin });
      const expired = challenge(jwt, { expiresIn: '-10s' });
      await expect(auth.verifyTwoFactorLogin({ challengeToken: expired, code: '123456' })).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        auth.verifyTwoFactorLogin({ challengeToken: challenge(jwt, {}, '2fa-enroll'), code: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const access = jwt.sign({ sub: admin.id, role: 'SUPER_ADMIN' });
      await expect(auth.verifyTwoFactorLogin({ challengeToken: access, code: '123456' })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('5 bad codes lock the second factor; success clears the counter', async () => {
      const { auth, jwt, twoFactor, cache, audit } = setup({ user: admin });
      twoFactor.verifyLogin.mockRejectedValue(new UnauthorizedException('bad') as never);
      const token = challenge(jwt);
      for (let i = 0; i < 4; i++) {
        await expect(auth.verifyTwoFactorLogin({ challengeToken: token, code: '000000' })).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(cache.store.get(`auth:fail:2fa:${admin.id}`)).toBe(4);
      await expect(auth.verifyTwoFactorLogin({ challengeToken: token, code: '000000' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(cache.store.get(`auth:lock:2fa:${admin.id}`)).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_LOCKED' }));

      // now locked: even a correct code is refused without consulting the verifier
      twoFactor.verifyLogin.mockClear();
      twoFactor.verifyLogin.mockResolvedValue({ usedRecoveryCode: false } as never);
      await expect(auth.verifyTwoFactorLogin({ challengeToken: token, code: '123456' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(twoFactor.verifyLogin).not.toHaveBeenCalled();
    });

    it('a successful verification resets the failure counter', async () => {
      const { auth, jwt, twoFactor, cache } = setup({ user: admin });
      const token = challenge(jwt);
      twoFactor.verifyLogin.mockRejectedValueOnce(new UnauthorizedException('bad') as never);
      await expect(auth.verifyTwoFactorLogin({ challengeToken: token, code: '000000' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(cache.store.get(`auth:fail:2fa:${admin.id}`)).toBe(1);
      await auth.verifyTwoFactorLogin({ challengeToken: token, code: '123456' });
      expect(cache.store.has(`auth:fail:2fa:${admin.id}`)).toBe(false);
    });
  });

  describe('password lockout', () => {
    const user = () => baseUser('VENDOR_ADMIN');

    it('case/whitespace variants of the identifier share one counter', async () => {
      const { auth, cache } = setup({ user: user() });
      await auth.validateUser('Admin@x.com ', 'wrong', { ip: '3.3.3.3' });
      await auth.validateUser('admin@x.com', 'wrong', { ip: '3.3.3.3' });
      await auth.validateUser('  ADMIN@X.COM', 'wrong', { ip: '3.3.3.3' });
      expect(cache.store.get('auth:fail:admin@x.com|3.3.3.3')).toBe(3);
    });

    it('counters are per identifier+ip (an attacker elsewhere cannot lock the victim)', async () => {
      const { auth, cache } = setup({ user: user() });
      for (let i = 0; i < 5; i++) {
        await auth.validateUser('victim@x.com', 'wrong', { ip: '6.6.6.6' }).catch(() => undefined);
      }
      expect(cache.store.get('auth:lock:victim@x.com|6.6.6.6')).toBe(true);
      // the legitimate user from another IP is not locked and can still log in
      const ok = await auth.validateUser('victim@x.com', 'Password123!', { ip: '7.7.7.7' });
      expect(ok).toMatchObject({ id: 'u-VENDOR_ADMIN' });
    });

    it('locked and wrong-password produce the same generic message; no account-exists leak', async () => {
      const { auth } = setup({ user: user() });
      const messages: string[] = [];
      for (let i = 0; i < 6; i++) {
        try {
          const r = await auth.validateUser('a@x.test', i === 5 ? 'Password123!' : 'wrong', { ip: '4.4.4.4' });
          messages.push(r === null ? 'Invalid credentials' : 'LOGGED IN');
        } catch (e) {
          messages.push((e as Error).message);
        }
      }
      // attempts 1-4: null (-> controller "Invalid credentials"); 5th trips the lock; 6th is refused even with the right password
      expect(new Set(messages)).toEqual(new Set(['Invalid credentials']));
      expect(messages.join()).not.toMatch(/lock/i);
    });

    it('thresholds come from settings (fallback constants otherwise)', async () => {
      const { auth, cache } = setup({ user: user(), policy: { loginMaxAttempts: 3, loginLockMinutes: 1 } });
      for (let i = 0; i < 3; i++) await auth.validateUser('a@x.test', 'wrong', { ip: '5.5.5.5' }).catch(() => undefined);
      expect(cache.store.get('auth:lock:a@x.test|5.5.5.5')).toBe(true);
      expect(cache.set).toHaveBeenCalledWith('auth:lock:a@x.test|5.5.5.5', true, 60_000);
    });

    it('writes LOGIN_FAILED then ACCOUNT_LOCKED audit rows', async () => {
      const { auth, audit } = setup({ user: user(), policy: { loginMaxAttempts: 3 } });
      for (let i = 0; i < 3; i++) await auth.validateUser('a@x.test', 'wrong', { ip: '8.8.8.8' }).catch(() => undefined);
      const actions = audit.log.mock.calls.map((c: any[]) => c[0].action);
      expect(actions).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED']);
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain('wrong');
    });

    it('success clears the identifier counter', async () => {
      const { auth, cache } = setup({ user: user() });
      await auth.validateUser('a@x.test', 'wrong', { ip: '1.2.3.4' });
      expect(cache.store.get('auth:fail:a@x.test|1.2.3.4')).toBe(1);
      await auth.validateUser('a@x.test', 'Password123!', { ip: '1.2.3.4' });
      expect(cache.store.has('auth:fail:a@x.test|1.2.3.4')).toBe(false);
    });
  });

  describe('refresh / logout / revoke', () => {
    it('refresh rejects a revoked session and does not rotate into new tokens', async () => {
      const { auth, cache, sessions } = setup({ user: baseUser('SUPER_ADMIN') });
      cache.store.set('auth:refresh:r1', { userId: 'u-SUPER_ADMIN', sessionId: 'sess-9', iat: 1 });
      sessions.assertActive.mockRejectedValue(new UnauthorizedException('Session has been revoked') as never);
      await expect(auth.refreshTokens('r1')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refresh keeps the same session (touch) and slides it', async () => {
      const { auth, cache, sessions, jwt } = setup({ user: baseUser('SUPER_ADMIN') });
      cache.store.set('auth:refresh:r1', { userId: 'u-SUPER_ADMIN', sessionId: 'sess-9', iat: 1 });
      const res: any = await auth.refreshTokens('r1', { ip: '1.1.1.1' });
      expect(sessions.touch).toHaveBeenCalledWith('sess-9', { ip: '1.1.1.1' });
      expect(sessions.create).not.toHaveBeenCalled();
      expect((jwt.decode(res.access_token) as any).sid).toBe('sess-9');
      expect(cache.store.has('auth:refresh:r1')).toBe(false); // rotated
    });

    it('legacy refresh values (no sessionId) keep working for non-admins', async () => {
      const { auth, cache } = setup({ user: baseUser('STAFF') });
      cache.store.set('auth:refresh:old', { userId: 'u-STAFF' });
      await expect(auth.refreshTokens('old')).resolves.toHaveProperty('access_token');
    });

    it('refresh is rejected after the user-wide revoke marker', async () => {
      const { auth, cache, sessions } = setup({ user: baseUser('STAFF') });
      cache.store.set('auth:refresh:r2', { userId: 'u-STAFF', iat: 5 });
      sessions.userTokensRevokedSince.mockResolvedValue(true as never);
      await expect(auth.refreshTokens('r2')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(cache.store.has('auth:refresh:r2')).toBe(false);
    });

    it('logout revokes the session behind the refresh token', async () => {
      const { auth, cache, sessions } = setup();
      cache.store.set('auth:refresh:r3', { userId: 'u1', sessionId: 's1' });
      await auth.logout('r3');
      expect(sessions.revoke).toHaveBeenCalledWith('s1', 'u1', expect.objectContaining({ reason: 'LOGOUT' }));
    });

    it('revokeUserSessions(userId) keeps its cross-phase signature and revokes everything', async () => {
      const { auth, sessions } = setup();
      expect(auth.revokeUserSessions.length).toBe(1);
      await expect(auth.revokeUserSessions('u1')).resolves.toBeUndefined();
      expect(sessions.revokeAllUserTokens).toHaveBeenCalledWith('u1', 'SESSIONS_REVOKED');
    });
  });
});

describe('JwtStrategy.validate (phase 5 additions)', () => {
  const base = { sub: 'u1', email: 'a@x.test', name: 'A', role: 'SUPER_ADMIN', vendorId: null };

  it('rejects a JWT whose sid was revoked', async () => {
    const cache = makeCache();
    cache.store.set(sessionRevokedKey('s1'), true);
    await expect(new JwtStrategy(cache as never).validate({ ...base, sid: 's1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a live sid and exposes it as sessionId', async () => {
    const cache = makeCache();
    await expect(new JwtStrategy(cache as never).validate({ ...base, sid: 's1' })).resolves.toMatchObject({ userId: 'u1', sessionId: 's1' });
  });

  it('JWT without sid is unaffected (back-compat) and has no sessionId', async () => {
    const cache = makeCache();
    const res = await new JwtStrategy(cache as never).validate({ ...base, role: 'STAFF', vendorId: 'v1' });
    expect(res).toMatchObject({ userId: 'u1', role: 'STAFF' });
    expect(res).not.toHaveProperty('sessionId');
  });

  it('rejects tokens issued before the user-wide revoke marker, accepts later ones', async () => {
    const cache = makeCache();
    cache.store.set(userRevokedBeforeKey('u1'), 1000);
    const strategy = new JwtStrategy(cache as never);
    await expect(strategy.validate({ ...base, iat: 999 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ ...base, iat: 1000 })).resolves.toMatchObject({ userId: 'u1' });
  });
});
