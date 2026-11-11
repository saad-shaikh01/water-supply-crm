import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { REGISTRY_BY_KEY, SETTINGS_REGISTRY } from './settings.registry';

export const PLATFORM_SETTINGS_CACHE_KEY = 'platform:settings:v1';
const REDIS_TTL_MS = 60_000;
const MEMO_MS = 5_000;

type ValueMap = Record<string, unknown>;

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private memo: { at: number; values: ValueMap } | null = null;
  private onChange: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly audit: AuditService,
  ) {}

  /** Lets dependants drop their own memo after a write. */
  registerOnChange(fn: () => void): void {
    this.onChange.push(fn);
  }

  private defaults(): ValueMap {
    return Object.fromEntries(SETTINGS_REGISTRY.map((d) => [d.key, d.default]));
  }

  /** Effective values for every registry key (defaults filled; invalid stored values ignored). */
  async getAll(): Promise<ValueMap> {
    if (this.memo && Date.now() - this.memo.at < MEMO_MS) return this.memo.values;
    let values: ValueMap | undefined;
    try {
      values = (await this.cache.get<ValueMap>(PLATFORM_SETTINGS_CACHE_KEY)) ?? undefined;
    } catch {
      /* fall through to DB */
    }
    if (!values) {
      values = this.defaults();
      try {
        const rows = await this.prisma.platformSetting.findMany();
        for (const r of rows) {
          const def = REGISTRY_BY_KEY.get(r.key);
          if (def && def.validate(r.value) === null) values[r.key] = r.value;
        }
        await this.cache.set(PLATFORM_SETTINGS_CACHE_KEY, values, REDIS_TTL_MS).catch(() => undefined);
      } catch (err) {
        this.logger.warn(`platform settings unavailable, using defaults: ${(err as Error).message}`);
      }
    }
    this.memo = { at: Date.now(), values };
    return values;
  }

  async get<T = unknown>(key: string): Promise<T> {
    return (await this.getAll())[key] as T;
  }

  async list() {
    const rows = await this.prisma.platformSetting.findMany({
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const values = await this.getAll();
    return {
      settings: SETTINGS_REGISTRY.map((d) => {
        const row = byKey.get(d.key);
        return {
          key: d.key,
          value: values[d.key],
          default: d.default,
          description: d.description,
          type: d.type,
          updatedAt: row?.updatedAt ?? null,
          updatedBy: row?.updatedBy ?? null,
        };
      }),
    };
  }

  /** Throws 503 MAINTENANCE_MODE when maintenance is ON (same body as MaintenanceGuard). */
  async assertNotInMaintenance(): Promise<void> {
    const v = await this.getAll();
    if (v['maintenance.enabled'] !== true) return;
    throw new HttpException(
      {
        statusCode: 503,
        code: 'MAINTENANCE_MODE',
        message: (v['maintenance.message'] as string) || 'The platform is under maintenance. Please try again shortly.',
        eta: (v['maintenance.eta'] as string | null) ?? null,
      },
      503,
    );
  }

  async publicStatus() {
    const v = await this.getAll();
    return {
      maintenance: {
        enabled: v['maintenance.enabled'] === true,
        message: (v['maintenance.message'] as string) ?? '',
        eta: (v['maintenance.eta'] as string | null) ?? null,
      },
      serverTime: new Date().toISOString(),
    };
  }

  /** Validates everything first, then writes atomically; one audit entry per changed key. */
  async update(changes: Record<string, unknown>, actor: AuthUser) {
    const keys = Object.keys(changes ?? {});
    if (!keys.length) throw new BadRequestException('No settings provided');
    const errors: string[] = [];
    for (const k of keys) {
      const def = REGISTRY_BY_KEY.get(k);
      if (!def) errors.push(`Unknown setting: ${k}`);
      else {
        const err = def.validate(changes[k]);
        if (err) errors.push(`${k} ${err}`);
      }
    }
    if (errors.length) throw new BadRequestException(errors);

    await this.invalidate();
    const before = await this.getAll();
    await this.prisma.$transaction(
      keys.map((k) =>
        this.prisma.platformSetting.upsert({
          where: { key: k },
          create: { key: k, value: changes[k] as never, updatedById: actor.userId },
          update: { value: changes[k] as never, updatedById: actor.userId },
        }),
      ),
    );
    await this.invalidate();

    for (const k of keys) {
      void this.audit.log({
        userId: actor.userId,
        userName: actor.name,
        action: 'PLATFORM_SETTING_UPDATED',
        entity: 'PlatformSetting',
        entityId: k,
        changes: { before: { value: before[k] }, after: { value: changes[k] } },
      });
    }
    return Object.fromEntries(keys.map((k) => [k, changes[k]]));
  }

  private async invalidate(): Promise<void> {
    this.memo = null;
    await this.cache.del(PLATFORM_SETTINGS_CACHE_KEY).catch(() => undefined);
    for (const fn of this.onChange) fn();
  }
}
