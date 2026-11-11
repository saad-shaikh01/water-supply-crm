import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ImpersonationService, impersonationActiveKey, impersonationHandoffKey } from './impersonation.service';

const SECRET = 'test-secret';
const superAdmin = { userId: 'sa1', name: 'Super', email: 's@x', role: 'SUPER_ADMIN', vendorId: null, customerId: null } as never;
const dto = (over: object = {}) => ({ vendorId: 'v1', reason: 'Investigating invoice problem', mode: 'READ_ONLY', ...over }) as never;

function setup(opts: { vendor?: unknown; target?: unknown } = {}) {
  const redis = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => redis.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void redis.set(k, v)),
    del: jest.fn(async (k: string) => void redis.delete(k)),
  };
  const sessions: any[] = [];
  const prisma = {
    vendor: { findUnique: jest.fn(async () => ('vendor' in opts ? opts.vendor : { id: 'v1', isActive: true })) },
    user: {
      findFirst: jest.fn(async ({ where }: any) => {
        const t = 'target' in opts ? opts.target : { id: 'u1', name: 'Admin', email: 'a@x', role: 'VENDOR_ADMIN', vendorId: 'v1' };
        // honour role filter like the DB would
        return t && where.role === 'VENDOR_ADMIN' && (t as any).role !== 'SUPER_ADMIN' ? t : null;
      }),
    },
    impersonationSession: {
      findMany: jest.fn(async ({ where }: any) => sessions.filter((s) => s.actorId === where.actorId && s.vendorId === where.vendorId && !s.endedAt)),
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `s${sessions.length + 1}`, actionCount: 0, handoffUsedAt: null, endedAt: null, endedReason: null, ...data };
        sessions.push(s);
        return s;
      }),
      findUnique: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of sessions) {
          if (where.id && s.id !== where.id) continue;
          if (where.endedAt === null && s.endedAt) continue;
          if (where.handoffUsedAt === null && s.handoffUsedAt) continue;
          if (where.expiresAt?.gt && !(s.expiresAt > where.expiresAt.gt)) continue;
          Object.assign(s, data);
          count++;
        }
        return { count };
      }),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const jwt = new JwtService({ secret: SECRET });
  const svc = new ImpersonationService(prisma as never, cache as never, audit as never, jwt);
  return { svc, redis, prisma, audit, sessions, jwt };
}

describe('ImpersonationService.start', () => {
  it('rejects a non super admin and a nested impersonation token', async () => {
    const { svc } = setup();
    await expect(svc.start({ ...(superAdmin as object), role: 'VENDOR_ADMIN' } as never, dto())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.start({ ...(superAdmin as object), impersonation: { sessionId: 'x' } } as never, dto())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects short reasons and ttl > 60', async () => {
    const { svc } = setup();
    await expect(svc.start(superAdmin, dto({ reason: 'too short' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.start(superAdmin, dto({ ttlMinutes: 90 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a suspended vendor and an unknown vendor', async () => {
    await expect(setup({ vendor: { id: 'v1', isActive: false } }).svc.start(superAdmin, dto())).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ vendor: null }).svc.start(superAdmin, dto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot target a SUPER_ADMIN / non vendor-admin user, nor an inactive/cross-vendor one (query is scoped)', async () => {
    const { svc, prisma } = setup({ target: { id: 'sa2', name: 'X', email: 'x', role: 'SUPER_ADMIN', vendorId: null } });
    await expect(svc.start(superAdmin, dto({ targetUserId: 'sa2' }))).rejects.toBeInstanceOf(BadRequestException);
    const where = (prisma.user.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ vendorId: 'v1', role: 'VENDOR_ADMIN', isActive: true, id: 'sa2' });
  });

  it('success writes session + redis keys + audit with the reason; code is in the URL, token is not', async () => {
    const { svc, redis, audit, sessions } = setup();
    const res = await svc.start(superAdmin, dto({ ttlMinutes: 15 }));
    expect(sessions).toHaveLength(1);
    expect(redis.get(impersonationActiveKey(res.sessionId))).toBe(true);
    const code = new URL(res.handoffUrl).searchParams.get('code')!;
    expect(redis.get(impersonationHandoffKey(code))).toEqual({ sid: res.sessionId });
    expect(res.handoffUrl).not.toMatch(/eyJ/);
    expect(res.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'IMPERSONATION_START',
        vendorId: 'v1',
        userId: 'sa1',
        changes: { after: expect.objectContaining({ reason: 'Investigating invoice problem', mode: 'READ_ONLY' }) },
      }),
    );
  });

  it('a new session for the same actor+vendor supersedes the old one', async () => {
    const { svc, redis, sessions } = setup();
    const a = await svc.start(superAdmin, dto());
    await svc.start(superAdmin, dto());
    expect(sessions[0].endedReason).toBe('SUPERSEDED');
    expect(redis.has(impersonationActiveKey(a.sessionId))).toBe(false);
  });
});

describe('ImpersonationService.exchange', () => {
  it('issues a short JWT with imp claim, role VENDOR_ADMIN, exp <= ttl, and NO refresh token; code is single-use', async () => {
    const { svc, jwt } = setup();
    const started = await svc.start(superAdmin, dto({ ttlMinutes: 15, mode: 'SUPPORT' }));
    const code = new URL(started.handoffUrl).searchParams.get('code')!;
    const res: any = await svc.exchange(code);
    expect(res.refresh_token).toBeUndefined();
    const p: any = jwt.verify(res.access_token);
    expect(p).toMatchObject({ sub: 'u1', role: 'VENDOR_ADMIN', vendorId: 'v1', imp: { sid: started.sessionId, actorId: 'sa1', mode: 'SUPPORT' } });
    expect(p.exp - p.iat).toBeLessThanOrEqual(15 * 60);
    await expect(svc.exchange(code)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('unknown/expired code fails; revoked session cannot be exchanged', async () => {
    const { svc } = setup();
    await expect(svc.exchange('0'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    const started = await svc.start(superAdmin, dto());
    await svc.end(started.sessionId, 'REVOKED', { userId: 'sa1', name: 'Super' });
    const code = new URL(started.handoffUrl).searchParams.get('code')!;
    await expect(svc.exchange(code)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('ImpersonationService.end', () => {
  it('exit deletes the redis key and audits IMPERSONATION_END; revoke audits IMPERSONATION_REVOKE; idempotent', async () => {
    const { svc, redis, audit, sessions } = setup();
    const a = await svc.start(superAdmin, dto());
    await svc.end(a.sessionId, 'EXIT', { userId: 'sa1', name: 'Super' });
    expect(redis.has(impersonationActiveKey(a.sessionId))).toBe(false);
    expect(sessions[0]).toMatchObject({ endedReason: 'EXIT' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'IMPERSONATION_END' }));
    const before = audit.log.mock.calls.length;
    await svc.end(a.sessionId, 'EXIT', { userId: 'sa1', name: 'Super' });
    expect(audit.log.mock.calls.length).toBe(before);

    const b = await svc.start(superAdmin, dto());
    await svc.end(b.sessionId, 'REVOKED', { userId: 'sa1', name: 'Super' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'IMPERSONATION_REVOKE' }));
  });

  it('unknown session -> 404', async () => {
    await expect(setup().svc.end('nope', 'REVOKED', { userId: 'sa1', name: 'S' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
