import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PlatformAdminService, generateTempPassword } from './platform-admin.service';
import { userInactiveKey } from '../user/user.service';

const actor = { userId: 'actor', email: 'a@x.test', name: 'Actor', role: 'SUPER_ADMIN', vendorId: null, customerId: null } as never;

function setup(opts: { target?: any; otherActive?: number; existingEmail?: boolean } = {}) {
  const target = opts.target === undefined ? { id: 't1', role: 'SUPER_ADMIN', isActive: true, email: 't@x.test', phoneNumber: null } : opts.target;
  const tx = {
    user: {
      findFirst: jest.fn(async () => target),
      count: jest.fn(async () => opts.otherActive ?? 1),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma: any = {
    tx,
    user: {
      findFirst: jest.fn(async () => target),
      findUnique: jest.fn(async ({ where }: any) => (where.email ? (opts.existingEmail ? { id: 'dup' } : null) : target)),
      findMany: jest.fn(async () => [
        { id: 'a1', name: 'A', email: 'a@x.test', isActive: true, lastLoginAt: null, mustChangePassword: false, createdAt: new Date(), twoFactor: { enabledAt: new Date() } },
        { id: 'a2', name: 'B', email: 'b@x.test', isActive: true, lastLoginAt: null, mustChangePassword: false, createdAt: new Date(), twoFactor: null },
      ]),
      count: jest.fn(async () => 2),
      create: jest.fn(async ({ data }: any) => ({ id: 'new1', ...data })),
      update: jest.fn(async () => ({})),
    },
    role: { findFirst: jest.fn(async () => ({ id: 'role-super' })) },
    authSession: { groupBy: jest.fn(async () => [{ userId: 'a1', _count: { _all: 3 } }]) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const cacheStore = new Map<string, unknown>();
  const cache = {
    set: jest.fn(async (k: string, v: unknown) => void cacheStore.set(k, v)),
    del: jest.fn(async (k: string) => void cacheStore.delete(k)),
    deleteByPattern: jest.fn(async () => undefined),
    store: cacheStore,
  };
  const audit = { log: jest.fn(async () => undefined) };
  const sessions = {
    revokeAllUserTokens: jest.fn(async () => undefined),
    list: jest.fn(async () => []),
    revoke: jest.fn(async () => undefined),
  };
  const twoFactor = { reset: jest.fn(async () => undefined) };
  const permissions = { invalidateUser: jest.fn(async () => undefined) };
  const auth = { generateResetToken: jest.fn(async () => undefined) };
  const svc = new PlatformAdminService(
    prisma as never, cache as never, audit as never, sessions as never, twoFactor as never, permissions as never, auth as never,
  );
  return { svc, prisma, tx, cache, audit, sessions, twoFactor, permissions, auth };
}

describe('PlatformAdminService', () => {
  it('list returns only SUPER_ADMIN rows with 2FA flag + session count and never a password', async () => {
    const { svc, prisma } = setup();
    const res = await svc.list({ page: 1, limit: 20 });
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(prisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty('password');
    expect(res.data[0]).toMatchObject({ id: 'a1', twoFactorEnabled: true, activeSessions: 3 });
    expect(res.data[1]).toMatchObject({ id: 'a2', twoFactorEnabled: false, activeSessions: 0 });
    expect(JSON.stringify(res)).not.toMatch(/"password"/);
  });

  describe('create', () => {
    it('generates a temp password returned once, hashes it, sets mustChangePassword, audits', async () => {
      const { svc, prisma, audit } = setup();
      const res: any = await svc.create({ name: 'New Admin', email: ' New@X.test ' }, actor);
      expect(res).toMatchObject({ id: 'new1', email: 'new@x.test', mustChangePassword: true });
      expect(res.tempPassword).toHaveLength(16);
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ role: 'SUPER_ADMIN', vendorId: null, mustChangePassword: true, roleId: 'role-super' });
      expect(await bcrypt.compare(res.tempPassword, data.password)).toBe(true);
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain(res.tempPassword);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'PlatformAdmin', userId: 'actor' }));
    });

    it('with a supplied password does not return one', async () => {
      const { svc } = setup();
      const res: any = await svc.create({ name: 'N', email: 'n@x.test', password: 'a-long-password-123' }, actor);
      expect(res).not.toHaveProperty('tempPassword');
    });

    it('duplicate email -> 409; non-SUPER_ADMIN actor -> 403', async () => {
      await expect(setup({ existingEmail: true }).svc.create({ name: 'N', email: 'n@x.test' }, actor)).rejects.toBeInstanceOf(ConflictException);
      await expect(
        setup().svc.create({ name: 'N', email: 'n@x.test' }, { ...(actor as object), role: 'VENDOR_ADMIN' } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deactivate', () => {
    it('self -> 400 SELF_DEACTIVATE', async () => {
      const { svc } = setup();
      const err: any = await svc.deactivate('actor', 'because', actor).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().code).toBe('SELF_DEACTIVATE');
    });

    it('last active admin -> 409 LAST_ADMIN and nothing is changed', async () => {
      const { svc, tx, cache, sessions } = setup({ otherActive: 0 });
      const err: any = await svc.deactivate('t1', 'cleanup', actor).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().code).toBe('LAST_ADMIN');
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(sessions.revokeAllUserTokens).not.toHaveBeenCalled();
    });

    it('runs Serializable, sets the inactive flag, revokes sessions, drops permissions, audits with reason', async () => {
      const { svc, prisma, tx, cache, sessions, permissions, audit } = setup({ otherActive: 1 });
      await expect(svc.deactivate('t1', 'left the company', actor)).resolves.toEqual({ id: 't1', isActive: false });
      expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { isActive: false } });
      expect(cache.store.get(userInactiveKey('t1'))).toBe(true);
      expect(sessions.revokeAllUserTokens).toHaveBeenCalledWith('t1', 'DEACTIVATED', 'actor');
      expect(permissions.invalidateUser).toHaveBeenCalledWith('t1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE', userId: 'actor', changes: expect.objectContaining({ reason: 'left the company' }) }),
      );
    });

    it('retries a Serialization failure and then reports LAST_ADMIN if it persists', async () => {
      const { Prisma } = jest.requireActual('@prisma/client');
      const { svc, prisma } = setup();
      const p2034 = () => new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'x' });
      prisma.$transaction.mockRejectedValue(p2034());
      const err: any = await svc.deactivate('t1', 'x', actor).catch((e) => e);
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(err.getResponse().code).toBe('LAST_ADMIN');
    });

    it('non-SUPER_ADMIN / unknown target -> 404', async () => {
      await expect(setup({ target: null }).svc.deactivate('x', 'r', actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('activate clears the inactive flag', async () => {
    const { svc, cache, permissions, prisma } = setup();
    cache.store.set(userInactiveKey('t1'), true);
    await svc.activate('t1', actor);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { isActive: true } });
    expect(cache.store.has(userInactiveKey('t1'))).toBe(false);
    expect(permissions.invalidateUser).toHaveBeenCalledWith('t1');
  });

  describe('reset-password', () => {
    it('TEMP returns the password once, hashes it, forces change, revokes sessions', async () => {
      const { svc, prisma, sessions, audit } = setup();
      const res: any = await svc.resetPassword('t1', 'TEMP', actor);
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.mustChangePassword).toBe(true);
      expect(await bcrypt.compare(res.tempPassword, data.password)).toBe(true);
      expect(sessions.revokeAllUserTokens).toHaveBeenCalledWith('t1', 'PASSWORD_RESET', 'actor');
      expect(JSON.stringify(audit.log.mock.calls)).not.toContain(res.tempPassword);
    });

    it('EMAIL sends the link and returns no password; self -> 400', async () => {
      const { svc, auth } = setup();
      const res: any = await svc.resetPassword('t1', 'EMAIL', actor);
      expect(auth.generateResetToken).toHaveBeenCalledWith('t@x.test');
      expect(res).not.toHaveProperty('tempPassword');
      await expect(svc.resetPassword('actor', 'TEMP', actor)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('reset-2fa removes the factor, revokes sessions, clears locks and audits; self -> 400', async () => {
    const { svc, twoFactor, sessions, audit, cache } = setup();
    await svc.resetTwoFactor('t1', 'lost phone', actor);
    expect(twoFactor.reset).toHaveBeenCalledWith('t1');
    expect(sessions.revokeAllUserTokens).toHaveBeenCalledWith('t1', '2FA_RESET', 'actor');
    expect(cache.del).toHaveBeenCalledWith('auth:lock:2fa:t1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESET_2FA', changes: { reason: 'lost phone' } }));
    await expect(svc.resetTwoFactor('actor', 'r', actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unlock clears identifier + ip-suffixed lock keys and audits', async () => {
    const { svc, cache, audit } = setup();
    await svc.unlock('t1', actor);
    expect(cache.set).toHaveBeenCalledWith('auth:unlocked:t@x.test', expect.any(Number), expect.any(Number));
    expect(cache.del).toHaveBeenCalledWith('auth:lock:t@x.test');
    expect(cache.deleteByPattern).toHaveBeenCalledWith('auth:lock:t@x.test|*');
    expect(cache.deleteByPattern).toHaveBeenCalledWith('auth:fail:t@x.test|*');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UNLOCK', userId: 'actor' }));
  });

  it('session admin view/revoke is scoped to the target admin', async () => {
    const { svc, sessions, audit } = setup();
    await svc.listSessions('t1');
    expect(sessions.list).toHaveBeenCalledWith('t1');
    await svc.revokeSession('t1', 's9', actor);
    expect(sessions.revoke).toHaveBeenCalledWith('s9', 't1', { reason: 'ADMIN_REVOKE', revokedById: 'actor' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REVOKE_SESSION' }));
  });

  it('generateTempPassword is 16 chars with all character classes and differs per call', () => {
    const a = generateTempPassword();
    expect(a).toHaveLength(16);
    expect(a).toMatch(/[A-Z]/);
    expect(a).toMatch(/[a-z]/);
    expect(a).toMatch(/[0-9]/);
    expect(a).toMatch(/[!@#$%*?]/);
    expect(generateTempPassword()).not.toBe(a);
  });
});
