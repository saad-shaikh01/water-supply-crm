import { BadRequestException, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformSettingsService, PLATFORM_SETTINGS_CACHE_KEY } from './platform-settings.service';
import { MaintenanceGuard } from './maintenance.guard';
import { isMaintenanceExemptPath, MAINTENANCE_EXEMPT_KEY } from './maintenance-exempt.decorator';
import { AuthSecurityPolicyService } from '../auth/security-policy.service';

function setup(rows: Array<{ key: string; value: unknown }> = []) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  const db = [...rows];
  const prisma: any = {
    platformSetting: {
      findMany: jest.fn(async () => db.map((r) => ({ ...r, updatedAt: new Date(), updatedBy: null }))),
      upsert: jest.fn(async ({ where, create }: any) => {
        const i = db.findIndex((r) => r.key === where.key);
        if (i >= 0) db[i] = { key: where.key, value: create.value };
        else db.push({ key: create.key, value: create.value });
        return create;
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new PlatformSettingsService(prisma, cache as any, audit as any);
  return { svc, cache, prisma, audit, store };
}
const actor: any = { userId: 'a1', name: 'Admin', role: 'SUPER_ADMIN' };

describe('PlatformSettingsService', () => {
  it('fills registry defaults and ignores invalid stored values', async () => {
    const { svc } = setup([{ key: 'security.loginMaxAttempts', value: 999 }]);
    const all = await svc.getAll();
    expect(all['maintenance.enabled']).toBe(false);
    expect(all['security.loginMaxAttempts']).toBe(5);
  });

  it('rejects unknown keys and invalid values (400) without writing', async () => {
    const { svc, prisma } = setup();
    await expect(svc.update({ 'nope.key': true }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update({ 'security.loginMaxAttempts': 2 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update({ 'maintenance.message': 'x'.repeat(501) }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.update({ 'maintenance.eta': 'garbage' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    // atomic batch: one bad key blocks the whole batch
    await expect(
      svc.update({ 'maintenance.enabled': true, 'maintenance.message': 5 }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it('writes, audits before/after and invalidates the cache', async () => {
    const { svc, cache, audit } = setup();
    expect((await svc.getAll())['maintenance.enabled']).toBe(false);
    await svc.update({ 'maintenance.enabled': true }, actor);
    expect(cache.del).toHaveBeenCalledWith(PLATFORM_SETTINGS_CACHE_KEY);
    expect((await svc.getAll())['maintenance.enabled']).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_SETTING_UPDATED',
        entityId: 'maintenance.enabled',
        changes: { before: { value: false }, after: { value: true } },
      }),
    );
  });

  it('publicStatus exposes only maintenance fields + serverTime', async () => {
    const { svc } = setup([{ key: 'maintenance.message', value: 'back soon' }]);
    const s = await svc.publicStatus();
    expect(Object.keys(s).sort()).toEqual(['maintenance', 'serverTime']);
    expect(s.maintenance).toEqual({ enabled: false, message: 'back soon', eta: null });
  });

  it('assertNotInMaintenance throws 503 only when enabled', async () => {
    const { svc } = setup();
    await expect(svc.assertNotInMaintenance()).resolves.toBeUndefined();
    await svc.update({ 'maintenance.enabled': true }, actor);
    await expect(svc.assertNotInMaintenance()).rejects.toMatchObject({ status: 503 });
  });

  it('auth security policy reads registry-backed settings and refreshes on change', async () => {
    const { svc } = setup([{ key: 'security.loginMaxAttempts', value: 8 }]);
    const policy = new AuthSecurityPolicyService(svc);
    expect((await policy.get()).loginMaxAttempts).toBe(8);
    expect((await policy.get()).loginLockMinutes).toBe(15);
    await svc.update({ 'security.loginMaxAttempts': 4 }, actor);
    expect((await policy.get()).loginMaxAttempts).toBe(4);
  });

  it('defaults.customerGroupingEnabled is readable as a boolean default', async () => {
    const { svc } = setup([{ key: 'defaults.customerGroupingEnabled', value: true }]);
    expect(await svc.get<boolean>('defaults.customerGroupingEnabled')).toBe(true);
  });
});

describe('MaintenanceGuard', () => {
  const ctx = (url: string, user?: any, meta: Record<string, boolean> = {}) => {
    const res = { setHeader: jest.fn() };
    const handler = () => undefined;
    class Cls {}
    const reflector = { getAllAndOverride: jest.fn((k: string) => meta[k]) } as unknown as Reflector;
    return {
      reflector,
      res,
      context: {
        getType: () => 'http',
        getHandler: () => handler,
        getClass: () => Cls,
        switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, user }), getResponse: () => res }),
      } as unknown as ExecutionContext,
    };
  };

  const settingsFor = (enabled: boolean) =>
    setup(
      enabled
        ? [
            { key: 'maintenance.enabled', value: true },
            { key: 'maintenance.message', value: 'down' },
          ]
        : [],
    ).svc;

  it('passes everything when maintenance is OFF', async () => {
    const c = ctx('/api/orders', { role: 'VENDOR_ADMIN' });
    await expect(new MaintenanceGuard(c.reflector, settingsFor(false)).canActivate(c.context)).resolves.toBe(true);
  });

  it('blocks non-admins with 503 MAINTENANCE_MODE + Retry-After when ON', async () => {
    const svc = settingsFor(true);
    const c = ctx('/api/orders', { role: 'VENDOR_ADMIN' });
    const err: HttpException = await new MaintenanceGuard(c.reflector, svc).canActivate(c.context).catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'MAINTENANCE_MODE', message: 'down', eta: null });
    expect(c.res.setHeader).toHaveBeenCalledWith('Retry-After', '120');
    const c2 = ctx('/api/customer-activation/activate');
    await expect(new MaintenanceGuard(c2.reflector, svc).canActivate(c2.context)).rejects.toBeInstanceOf(HttpException);
  });

  it('never blocks SUPER_ADMIN, health, auth, status, payment webhooks or @MaintenanceExempt routes', async () => {
    const svc = settingsFor(true);
    const cases: Array<[string, any, Record<string, boolean>?]> = [
      ['/api/vendors', { role: 'SUPER_ADMIN' }],
      ['/api/health', undefined],
      ['/api/health/ready', undefined],
      ['/api/auth/login', undefined],
      ['/api/auth/refresh', undefined],
      ['/api/auth/2fa/verify', undefined],
      ['/api/auth/forgot-password', undefined],
      ['/api/platform/status?x=1', undefined],
      ['/api/webhooks/paymob', undefined],
      ['/api/anything', { role: 'CUSTOMER' }, { [MAINTENANCE_EXEMPT_KEY]: true }],
    ];
    for (const [url, user, meta] of cases) {
      const c = ctx(url, user, meta);
      await expect(new MaintenanceGuard(c.reflector, svc).canActivate(c.context)).resolves.toBe(true);
    }
  });

  it('path matcher is prefix-safe', () => {
    expect(isMaintenanceExemptPath('/api/authors')).toBe(false);
    expect(isMaintenanceExemptPath('/api/healthz-fake')).toBe(false);
    expect(isMaintenanceExemptPath('/api/webhooks/paymob')).toBe(true);
    expect(isMaintenanceExemptPath('/api/platform/status')).toBe(true);
    expect(isMaintenanceExemptPath('/api/platform-settings')).toBe(false);
  });
});
