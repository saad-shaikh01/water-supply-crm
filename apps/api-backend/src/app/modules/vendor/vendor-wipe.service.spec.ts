import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { AuthUser } from '@water-supply-crm/types';
import { VendorWipeService } from './vendor-wipe.service';

const VENDOR = { id: 'v-1', name: 'Acme', slug: 'acme', isActive: false };
const ACTOR = { userId: 'su-1', name: 'Root' } as unknown as AuthUser;
const OLD_ENV = { ...process.env };

function build(opts: { vendor?: typeof VENDOR | null; rowsPerTable?: number; passwordHash?: string | null; role?: string } = {}) {
  const vendor = opts.vendor === undefined ? VENDOR : opts.vendor;
  const executed: string[] = [];
  const tx = {
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      executed.push(sql);
      return sql.startsWith('DELETE') ? 2 : 0;
    }),
    vendor: { update: jest.fn() },
  };
  const prisma = {
    vendor: { findUnique: jest.fn(async () => vendor) },
    user: { findUnique: jest.fn(async () => ({ password: opts.passwordHash === undefined ? null : opts.passwordHash, role: opts.role ?? 'SUPER_ADMIN' })) },
    $queryRawUnsafe: jest.fn(async () => [{ n: opts.rowsPerTable ?? 0 }]),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };
  const provisioning = { provisionInTx: jest.fn() };
  const audit = { log: jest.fn() };
  const cache = {
    invalidateVendorEntity: jest.fn(),
    invalidateOverview: jest.fn(),
    invalidateAnalytics: jest.fn(),
    invalidateDailyDashboard: jest.fn(),
  };
  const service = new VendorWipeService(prisma as never, provisioning as never, audit as never, cache as never);
  return { service, prisma, tx, provisioning, audit, cache, executed };
}

const goodDto = (over: Record<string, unknown> = {}) => ({ confirmSlug: 'acme', password: 'pw', acknowledgeBackup: true, previewToken: 'tok', ...over }) as never;

describe('VendorWipeService', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, VENDOR_WIPE_ENABLED: 'true', WHATSAPP_ALLOWED_VENDOR_IDS: '' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('preview', () => {
    it('lists only tables that have rows, biggest first, and a stable token', async () => {
      const { service, prisma } = build({ rowsPerTable: 0 });
      let call = 0;
      prisma.$queryRawUnsafe.mockImplementation(async () => [{ n: ++call === 2 ? 5 : call === 3 ? 9 : 0 }]);
      const p = await service.preview('v-1');
      expect(p.tables.map((t) => t.rows)).toEqual([9, 5]);
      expect(p.totalRows).toBe(14);
      expect(p.allowed).toBe(true);
      expect(p.previewToken).toMatch(/^[0-9a-f]{32}$/);
      expect(p.keeps.length).toBeGreaterThan(0);
    });

    it('reports every blocker: disabled, protected and not suspended', async () => {
      process.env['VENDOR_WIPE_ENABLED'] = 'false';
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-1';
      const { service } = build({ vendor: { ...VENDOR, isActive: true } });
      const p = await service.preview('v-1');
      expect(p.allowed).toBe(false);
      expect(p.blockers.map((b) => b.code).sort()).toEqual(['NOT_SUSPENDED', 'PROTECTED_VENDOR', 'WIPE_DISABLED']);
    });

    it('404s for an unknown vendor', async () => {
      const { service } = build({ vendor: null });
      await expect(service.preview('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('wipe guards (nothing is deleted unless every one passes)', () => {
    const expectUntouched = (h: ReturnType<typeof build>) => {
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.audit.log).not.toHaveBeenCalled();
    };

    it('is refused while the feature switch is off', async () => {
      process.env['VENDOR_WIPE_ENABLED'] = '';
      const h = build();
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto())).rejects.toBeInstanceOf(ForbiddenException);
      expectUntouched(h);
    });

    it('is refused for a protected (legacy) vendor even when enabled', async () => {
      process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'v-1';
      const h = build();
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto())).rejects.toThrow(/protected/);
      expectUntouched(h);
    });

    it('is refused while the vendor is active', async () => {
      const h = build({ vendor: { ...VENDOR, isActive: true } });
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto())).rejects.toBeInstanceOf(ConflictException);
      expectUntouched(h);
    });

    it('needs the exact slug', async () => {
      const h = build();
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto({ confirmSlug: 'Acme' }))).rejects.toBeInstanceOf(BadRequestException);
      expectUntouched(h);
    });

    it('needs the super admin password (403, so the web client does not log out)', async () => {
      const h = build({ passwordHash: await bcrypt.hash('right', 4) });
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto({ password: 'wrong' }))).rejects.toBeInstanceOf(ForbiddenException);
      expectUntouched(h);
    });

    it('only a SUPER_ADMIN account passes the password check', async () => {
      const h = build({ passwordHash: await bcrypt.hash('pw', 4), role: 'VENDOR_ADMIN' });
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto())).rejects.toBeInstanceOf(ForbiddenException);
      expectUntouched(h);
    });

    it('is refused when the data changed since the preview', async () => {
      const h = build({ passwordHash: await bcrypt.hash('pw', 4), rowsPerTable: 3 });
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto({ previewToken: 'stale' }))).rejects.toThrow(/changed since the preview/);
      expectUntouched(h);
    });
  });

  describe('wipe', () => {
    it('runs nullify + delete steps in one transaction, resets go-live, re-provisions, drops caches and audits without a vendorId', async () => {
      const h = build({ passwordHash: await bcrypt.hash('pw', 4), rowsPerTable: 1 });
      const token = (await h.service.preview('v-1')).previewToken;

      const res = await h.service.wipe(ACTOR, 'v-1', goodDto({ previewToken: token }));

      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.executed[0]).toContain('pg_advisory_xact_lock');
      const firstDelete = h.executed.findIndex((s) => s.startsWith('DELETE'));
      const lastNullify = h.executed.map((s) => s.startsWith('UPDATE')).lastIndexOf(true);
      expect(firstDelete).toBeGreaterThan(lastNullify); // cycle-breaking updates always come first
      expect(h.executed.filter((s) => s.startsWith('DELETE')).length).toBeGreaterThan(50);
      expect(h.tx.vendor.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { goLiveAt: null } });
      expect(h.provisioning.provisionInTx).toHaveBeenCalledWith(h.tx, 'v-1');
      expect(h.cache.invalidateOverview).toHaveBeenCalledWith('v-1');

      expect(h.audit.log).toHaveBeenCalledTimes(1);
      const logged = h.audit.log.mock.calls[0][0] as Record<string, unknown>;
      expect(logged).toMatchObject({ action: 'WIPE_VENDOR_DATA', entity: 'Vendor', entityId: 'v-1', userId: 'su-1' });
      expect(logged['vendorId']).toBeUndefined(); // survives the wipe of the vendor's own audit rows

      expect(res.totalRows).toBeGreaterThan(0);
      expect(res.message).toMatch(/still suspended/);
    });

    it('rethrows (and audits nothing) when the transaction fails, so the database is left as it was', async () => {
      const h = build({ passwordHash: await bcrypt.hash('pw', 4), rowsPerTable: 1 });
      const token = (await h.service.preview('v-1')).previewToken;
      h.prisma.$transaction.mockRejectedValueOnce(new Error('fk violation'));
      await expect(h.service.wipe(ACTOR, 'v-1', goodDto({ previewToken: token }))).rejects.toThrow('fk violation');
      expect(h.audit.log).not.toHaveBeenCalled();
      expect(h.cache.invalidateOverview).not.toHaveBeenCalled();
    });
  });
});
