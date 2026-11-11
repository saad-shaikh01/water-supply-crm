import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthSessionService, sessionRevokedKey, userRevokedBeforeKey } from './auth-session.service';

function makeFakes() {
  const rows: any[] = [];
  const users: Record<string, any> = { u1: {}, u2: {} };
  let seq = 0;
  const match = (r: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'revokedAt') return v === null ? r.revokedAt === null : true;
      if (k === 'expiresAt') return r.expiresAt > v.gt;
      if (k === 'id') return typeof v === 'string' ? r.id === v : v.in ? v.in.includes(r.id) : r.id !== v.not;
      return r[k] === v;
    });
  const prisma: any = {
    rows,
    users,
    authSession: {
      create: jest.fn(async ({ data }: any) => {
        const r = { id: `s${++seq}`, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, revokedById: null, revokeReason: null, ...data };
        rows.push(r);
        return r;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where))),
      count: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).length),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
    user: { update: jest.fn(async ({ where, data }: any) => Object.assign(users[where.id], data)) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const store = new Map<string, unknown>();
  const cache = {
    store,
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  return { prisma, cache };
}

describe('AuthSessionService', () => {
  let f: ReturnType<typeof makeFakes>;
  let svc: AuthSessionService;
  beforeEach(() => {
    f = makeFakes();
    svc = new AuthSessionService(f.prisma, f.cache as never);
  });

  it('create stores ip/userAgent, a 7d expiry, and stamps lastLoginAt', async () => {
    const s = await svc.create('u1', { ip: '1.1.1.1', userAgent: 'UA' });
    expect(s).toMatchObject({ userId: 'u1', ip: '1.1.1.1', userAgent: 'UA' });
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 3600 * 1000);
    expect(f.prisma.users.u1.lastLoginAt).toBeInstanceOf(Date);
  });

  it('list returns only own, live sessions and flags current', async () => {
    const a = await svc.create('u1');
    const b = await svc.create('u1');
    await svc.create('u2');
    await svc.revoke(b.id, 'u1', { reason: 'USER_REVOKE' });
    const list = await svc.list('u1', a.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, current: true });
  });

  it('revoke sets the Redis flag; user cannot revoke another user\'s session (404)', async () => {
    const a = await svc.create('u1');
    await expect(svc.revoke(a.id, 'u2', { reason: 'USER_REVOKE' })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.cache.store.has(sessionRevokedKey(a.id))).toBe(false);
    await svc.revoke(a.id, 'u1', { reason: 'ADMIN_REVOKE', revokedById: 'admin' });
    expect(f.cache.store.get(sessionRevokedKey(a.id))).toBe(true);
    expect(f.prisma.rows[0]).toMatchObject({ revokeReason: 'ADMIN_REVOKE', revokedById: 'admin' });
    await expect(svc.revoke(a.id, 'u1', { reason: 'USER_REVOKE' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokeAll keeps the excepted session and returns the count', async () => {
    const keep = await svc.create('u1');
    await svc.create('u1');
    await svc.create('u1');
    await svc.create('u2');
    expect(await svc.revokeAll('u1', { reason: 'USER_REVOKE', exceptSessionId: keep.id })).toBe(2);
    expect((await svc.list('u1')).map((s) => s.id)).toEqual([keep.id]);
    expect((await svc.list('u2')).length).toBe(1);
    expect(await svc.revokeAll('u1', { reason: 'PASSWORD_RESET' })).toBe(1);
    expect(await svc.countActive('u1')).toBe(0);
  });

  it('assertActive rejects revoked (flag or DB), expired and unknown sessions', async () => {
    const a = await svc.create('u1');
    await expect(svc.assertActive(a.id)).resolves.toBeUndefined();
    f.cache.store.set(sessionRevokedKey(a.id), true);
    await expect(svc.assertActive(a.id)).rejects.toBeInstanceOf(UnauthorizedException);
    f.cache.store.clear();
    f.prisma.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.assertActive(a.id)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.assertActive('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    f.prisma.rows[0].expiresAt = new Date(Date.now() + 1000);
    f.prisma.rows[0].revokedAt = new Date();
    await expect(svc.assertActive(a.id)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('touch slides expiry', async () => {
    const a = await svc.create('u1');
    const before = a.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await svc.touch(a.id, { ip: '2.2.2.2' });
    expect(f.prisma.rows[0].expiresAt.getTime()).toBeGreaterThan(before);
    expect(f.prisma.rows[0].ip).toBe('2.2.2.2');
  });

  it('revokeAllUserTokens revokes sessions and writes the revoked-before marker', async () => {
    await svc.create('u1');
    await svc.revokeAllUserTokens('u1', 'PASSWORD_RESET');
    expect(await svc.countActive('u1')).toBe(0);
    const marker = f.cache.store.get(userRevokedBeforeKey('u1')) as number;
    expect(marker).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(await svc.userTokensRevokedSince('u1', marker - 1)).toBe(true);
    expect(await svc.userTokensRevokedSince('u1', marker)).toBe(false);
    expect(await svc.userTokensRevokedSince('u1', undefined)).toBe(true);
    expect(await svc.userTokensRevokedSince('u2', 1)).toBe(false);
  });
});
