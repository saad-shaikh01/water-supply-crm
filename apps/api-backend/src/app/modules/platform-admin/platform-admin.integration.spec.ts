import { randomUUID } from 'crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { UserRole } from '@prisma/client';
import { PlatformAdminService } from './platform-admin.service';

/**
 * Real-Postgres test for last-SUPER_ADMIN protection (incl. the Serializable race).
 *
 * Opt-in: set TEST_DATABASE_URL to a THROWAWAY database whose migrations are applied. This suite
 * DELETES EVERY SUPER_ADMIN user in that database, so it never falls back to DATABASE_URL.
 *
 *   TEST_DATABASE_URL=postgresql://... npx jest -c jest.config.cts platform-admin.integration
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(60000);

describeDb('PlatformAdminService (real Postgres)', () => {
  const RUN = randomUUID().slice(0, 8);
  const prisma = new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://skipped:skipped@localhost:1/skipped' } } });
  const cacheStore = new Map<string, unknown>();
  const cache = {
    set: jest.fn(async (k: string, v: unknown) => void cacheStore.set(k, v)),
    del: jest.fn(async (k: string) => void cacheStore.delete(k)),
    deleteByPattern: jest.fn(),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const sessions = { revokeAllUserTokens: jest.fn(async () => undefined), list: jest.fn(), revoke: jest.fn() };
  const permissions = { invalidateUser: jest.fn(async () => undefined) };
  const svc = new PlatformAdminService(
    prisma, cache as never, audit as never, sessions as never, { reset: jest.fn() } as never, permissions as never,
    { generateResetToken: jest.fn() } as never,
  );
  const actor = (id: string) => ({ userId: id, email: 'x@x.test', name: 'X', role: 'SUPER_ADMIN', vendorId: null, customerId: null }) as never;

  const mk = async (tag: string) => (await svc.create({ name: `Admin ${tag}`, email: `${tag}-${RUN}@example.test`, password: 'a-long-password-123' }, actor('root'))).id;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { role: UserRole.SUPER_ADMIN } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { role: UserRole.SUPER_ADMIN } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.test` } } });
    await prisma.$disconnect();
  });

  it('refuses to deactivate the only active admin (409 LAST_ADMIN)', async () => {
    const only = await mk('only');
    const err: any = await svc.deactivate(only, 'cleanup', actor('someone-else')).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('LAST_ADMIN');
    expect((await prisma.user.findUnique({ where: { id: only } }))?.isActive).toBe(true);
  });

  it('with two admins deactivates one, then refuses the survivor', async () => {
    const a = await mk('a');
    const b = await mk('b');
    await expect(svc.deactivate(b, 'r', actor(a))).resolves.toEqual({ id: b, isActive: false });
    await expect(svc.deactivate(a, 'r', actor('other'))).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.user.findUnique({ where: { id: a } }))?.isActive).toBe(true);
  });

  it('two CONCURRENT deactivations of the last two admins: exactly one succeeds', async () => {
    for (let round = 0; round < 3; round++) {
      await prisma.user.deleteMany({ where: { role: UserRole.SUPER_ADMIN } });
      const x = await mk(`x${round}`);
      const y = await mk(`y${round}`);
      const results = await Promise.allSettled([svc.deactivate(x, 'r', actor(y)), svc.deactivate(y, 'r', actor(x))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(await prisma.user.count({ where: { role: UserRole.SUPER_ADMIN, isActive: true } })).toBe(1);
    }
  });

  it('cannot manage non-SUPER_ADMIN users (404) and list excludes them', async () => {
    await mk('keep');
    const vendorAdmin = await prisma.user.create({
      data: { name: 'VA', email: `va-${RUN}@example.test`, password: 'x', role: UserRole.VENDOR_ADMIN },
    });
    await expect(svc.deactivate(vendorAdmin.id, 'r', actor('root'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.unlock(vendorAdmin.id, actor('root'))).rejects.toBeInstanceOf(NotFoundException);
    const list = await svc.list({ page: 1, limit: 50 });
    expect(list.data.every((u: any) => u.id !== vendorAdmin.id)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/"password"/);
  });

  it('create persists mustChangePassword and a bcrypt hash', async () => {
    const id = await mk('c');
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row).toMatchObject({ role: 'SUPER_ADMIN', vendorId: null, mustChangePassword: true });
    expect(row?.password).toMatch(/^\$2[aby]\$/);
  });
});
