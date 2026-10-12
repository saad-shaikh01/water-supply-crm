import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService, CACHE_KEYS } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { isLegacyVendor } from '../../common/tenant-gate/legacy-vendor-gate';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { planVendorWipe } from './vendor-wipe.planner';
import type { WipeVendorDto } from './dto/wipe-vendor.dto';

export interface WipeBlocker {
  code: 'WIPE_DISABLED' | 'PROTECTED_VENDOR' | 'NOT_SUSPENDED';
  message: string;
}

/** What a wipe leaves in place, in plain words (shown in the confirmation dialog). */
const KEEPS = [
  'The vendor record itself (name, slug, settings)',
  'Company profile / branding and the WhatsApp sender',
  'Roles and role permissions',
  'The vendor admin login(s) — the same admin can sign in again',
];

const COUNT_PARALLELISM = 6;

/**
 * Super-admin "wipe vendor data": removes every row a vendor owns so the vendor can be set up
 * (or imported) again from scratch. Deliberately hard to trigger — see `blockers()` and `wipe()`.
 * The SQL comes from `planVendorWipe` (derived from the Prisma schema, covered by its own spec).
 */
@Injectable()
export class VendorWipeService {
  private readonly logger = new Logger(VendorWipeService.name);
  private readonly plan = planVendorWipe(Prisma.dmmf.datamodel.models as never);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: VendorProvisioningService,
    private readonly audit: AuditService,
    private readonly cache: CacheInvalidationService,
  ) {}

  private enabled(): boolean {
    return process.env['VENDOR_WIPE_ENABLED'] === 'true';
  }

  private blockers(vendor: { id: string; isActive: boolean }): WipeBlocker[] {
    const out: WipeBlocker[] = [];
    if (!this.enabled()) {
      out.push({ code: 'WIPE_DISABLED', message: 'Vendor wipe is switched off on this server. Set VENDOR_WIPE_ENABLED=true and restart the API to allow it.' });
    }
    if (isLegacyVendor(vendor.id)) {
      out.push({ code: 'PROTECTED_VENDOR', message: 'This is a protected (legacy / production) vendor and can never be wiped from here.' });
    }
    if (vendor.isActive) {
      out.push({ code: 'NOT_SUSPENDED', message: 'Suspend the vendor first, so nobody can write data while it is being removed.' });
    }
    return out;
  }

  private async loadVendor(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id }, select: { id: true, name: true, slug: true, isActive: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  private async countRows(vendorId: string): Promise<{ model: string; rows: number }[]> {
    const out: { model: string; rows: number }[] = [];
    const steps = this.plan.countSteps;
    for (let i = 0; i < steps.length; i += COUNT_PARALLELISM) {
      const batch = await Promise.all(
        steps.slice(i, i + COUNT_PARALLELISM).map(async (s) => {
          const r = (await this.prisma.$queryRawUnsafe(s.sql, vendorId)) as { n: number }[];
          return { model: s.model, rows: Number(r[0]?.n ?? 0) };
        }),
      );
      out.push(...batch);
    }
    return out.filter((t) => t.rows > 0).sort((a, b) => b.rows - a.rows);
  }

  private tokenOf(vendorId: string, tables: { model: string; rows: number }[]): string {
    const stable = [...tables].sort((a, b) => a.model.localeCompare(b.model)).map((t) => [t.model, t.rows]);
    return createHash('sha256').update(JSON.stringify([vendorId, stable])).digest('hex').slice(0, 32);
  }

  /** Read-only: what a wipe would remove, and whether it is currently allowed. */
  async preview(vendorId: string) {
    const vendor = await this.loadVendor(vendorId);
    const tables = await this.countRows(vendorId);
    const blockers = this.blockers(vendor);
    return {
      vendor,
      allowed: blockers.length === 0,
      blockers,
      tables,
      totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
      keeps: KEEPS,
      previewToken: this.tokenOf(vendorId, tables),
    };
  }

  async wipe(actor: AuthUser, vendorId: string, dto: WipeVendorDto) {
    const vendor = await this.loadVendor(vendorId);

    const blockers = this.blockers(vendor);
    if (blockers.length > 0) {
      const notSuspendedOnly = blockers.every((b) => b.code === 'NOT_SUSPENDED');
      const message = blockers.map((b) => b.message).join(' ');
      throw notSuspendedOnly ? new ConflictException(message) : new ForbiddenException(message);
    }
    if (dto.confirmSlug.trim() !== vendor.slug) {
      throw new BadRequestException('The vendor slug you typed does not match.');
    }

    // Re-authenticate. 403 (not 401) so the web client does not treat a typo as an expired session.
    const me = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { password: true, role: true } });
    if (!me?.password || me.role !== 'SUPER_ADMIN' || !(await bcrypt.compare(dto.password, me.password))) {
      throw new ForbiddenException('Incorrect password.');
    }

    // The data must still be what the super admin looked at.
    const before = await this.countRows(vendorId);
    if (this.tokenOf(vendorId, before) !== dto.previewToken) {
      throw new ConflictException('The data changed since the preview was loaded. Open the preview again and re-confirm.');
    }

    this.logger.warn(`WIPE vendor ${vendor.slug} (${vendorId}) started by ${actor.userId}: ${before.reduce((s, t) => s + t.rows, 0)} rows in ${before.length} tables`);

    const deleted: Record<string, number> = {};
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `vendor-wipe:${vendorId}`);
          for (const s of this.plan.nullifySteps) await tx.$executeRawUnsafe(s.sql, vendorId);
          for (const s of this.plan.deleteSteps) deleted[s.model] = Number(await tx.$executeRawUnsafe(s.sql, vendorId));
          // Back to the "just created" state: not live, roles and starter catalogues re-seeded.
          await tx.vendor.update({ where: { id: vendorId }, data: { goLiveAt: null } });
          await this.provisioning.provisionInTx(tx, vendorId);
        },
        { timeout: 15 * 60_000, maxWait: 10_000 },
      );
    } catch (e) {
      this.logger.error(`WIPE vendor ${vendor.slug} (${vendorId}) FAILED and was rolled back: ${(e as Error).message}`);
      throw e;
    }

    await this.dropCaches(vendorId);

    const rows = Object.entries(deleted).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, [, n]) => s + n, 0);
    // Written AFTER the wipe and without a vendorId: the vendor's own audit rows were just removed,
    // but the fact that it happened must survive.
    await this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action: 'WIPE_VENDOR_DATA',
      entity: 'Vendor',
      entityId: vendorId,
      changes: { after: { slug: vendor.slug, name: vendor.name, totalRows: total, tables: Object.fromEntries(rows) } },
    });
    this.logger.warn(`WIPE vendor ${vendor.slug} (${vendorId}) done: ${total} rows in ${rows.length} tables`);

    return {
      message: `All data of "${vendor.name}" was removed. The vendor is still suspended — set it up again, then unsuspend it.`,
      totalRows: total,
      tables: rows.map(([model, n]) => ({ model, rows: n })),
    };
  }

  private async dropCaches(vendorId: string) {
    try {
      await Promise.all([
        ...Object.values(CACHE_KEYS).map((k) => this.cache.invalidateVendorEntity(vendorId, k)),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateAnalytics(vendorId),
        this.cache.invalidateDailyDashboard(vendorId),
      ]);
    } catch (e) {
      this.logger.warn(`Wipe of ${vendorId}: cache invalidation failed (${(e as Error).message}); entries expire on their own TTL.`);
    }
  }
}
