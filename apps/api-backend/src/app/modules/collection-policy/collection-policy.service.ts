import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { CollectionPolicy } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';

/** Safety-net TTL; the cache is also invalidated explicitly on every write. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_POLICY: CollectionPolicy = {
  enabled: false,
  minOutstandingThreshold: 1000,
  minCollectionPercentage: 90,
  allowedShortfall: 300,
};

/**
 * Vendor-configurable Monthly Customer Collection Policy (minimum-collection
 * floor against the customer's remaining previous month outstanding).
 *
 * A missing DB row means the policy is DISABLED (mirrors
 * `NotificationSettingsService`'s "missing row = default" convention), so
 * vendors only ever persist a row once they've explicitly configured it.
 * Reads are cached per vendor and the cache is dropped on every write so a
 * toggle takes effect immediately.
 */
@Injectable()
export class CollectionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly audit: AuditService,
  ) {}

  private cacheKey(vendorId: string): string {
    return `vendor:${vendorId}:collection-policy`;
  }

  /** Load the vendor's policy (cached). Missing row returns the default (disabled). */
  async getPolicy(vendorId: string): Promise<CollectionPolicy> {
    const cacheKey = this.cacheKey(vendorId);
    const cached = await this.cache.get<CollectionPolicy>(cacheKey);
    if (cached) return cached;

    const row = await this.prisma.collectionPolicyConfig.findUnique({ where: { vendorId } });
    const policy: CollectionPolicy = row
      ? {
          enabled: row.enabled,
          minOutstandingThreshold: row.minOutstandingThreshold,
          minCollectionPercentage: row.minCollectionPercentage,
          allowedShortfall: row.allowedShortfall,
        }
      : { ...DEFAULT_POLICY };

    await this.cache.set(cacheKey, policy, CACHE_TTL_MS);
    return policy;
  }

  /** Upsert the vendor's policy, drop the cache, and audit the change. */
  async updatePolicy(vendorId: string, dto: UpdateCollectionPolicyDto): Promise<CollectionPolicy> {
    const row = await this.prisma.collectionPolicyConfig.upsert({
      where: { vendorId },
      create: { vendorId, ...dto },
      update: { ...dto },
    });
    await this.cache.del(this.cacheKey(vendorId));

    await this.audit.log({
      vendorId,
      action: 'UPDATE_COLLECTION_POLICY',
      entity: 'CollectionPolicyConfig',
      entityId: row.id,
      changes: { after: dto },
    });

    return {
      enabled: row.enabled,
      minOutstandingThreshold: row.minOutstandingThreshold,
      minCollectionPercentage: row.minCollectionPercentage,
      allowedShortfall: row.allowedShortfall,
    };
  }
}
