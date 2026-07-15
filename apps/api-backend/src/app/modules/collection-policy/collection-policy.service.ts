import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { PaymentType } from '@prisma/client';
import type { CollectionPolicy, CashCollectionPolicy } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';
import { UpdateCashCollectionPolicyDto } from './dto/update-cash-collection-policy.dto';
import { CashCollectionPolicyImpactQueryDto } from './dto/cash-collection-policy-impact-query.dto';
import { projectCashRequiredFromBalance } from '../../common/helpers/collection-policy.util';

/** §8.1's second impact-hint threshold ("...M of them more than ₨1,000"). */
const IMPACT_LARGE_REQUIREMENT_THRESHOLD = 1000;

/** Safety-net TTL; the cache is also invalidated explicitly on every write. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_POLICY: CollectionPolicy = {
  enabled: false,
  minOutstandingThreshold: 1000,
  minCollectionPercentage: 90,
  allowedShortfall: 300,
};

const DEFAULT_CASH_POLICY: CashCollectionPolicy = {
  enabled: false,
  allowedCreditDeliveries: 2,
  minExposureFloor: 500,
  maxOutstandingCeiling: null,
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

  private cashCacheKey(vendorId: string): string {
    return `vendor:${vendorId}:cash-collection-policy`;
  }

  /** Load the vendor's Cash Collection Policy (cached). Missing row returns the default (disabled). */
  async getCashPolicy(vendorId: string): Promise<CashCollectionPolicy> {
    const cacheKey = this.cashCacheKey(vendorId);
    const cached = await this.cache.get<CashCollectionPolicy>(cacheKey);
    if (cached) return cached;

    const row = await this.prisma.cashCollectionPolicyConfig.findUnique({ where: { vendorId } });
    const policy: CashCollectionPolicy = row
      ? {
          enabled: row.enabled,
          allowedCreditDeliveries: row.allowedCreditDeliveries,
          minExposureFloor: row.minExposureFloor,
          maxOutstandingCeiling: row.maxOutstandingCeiling,
        }
      : { ...DEFAULT_CASH_POLICY };

    await this.cache.set(cacheKey, policy, CACHE_TTL_MS);
    return policy;
  }

  /** Upsert the vendor's Cash Collection Policy, drop the cache, and audit the change. */
  async updateCashPolicy(vendorId: string, dto: UpdateCashCollectionPolicyDto): Promise<CashCollectionPolicy> {
    if (dto.maxOutstandingCeiling != null && dto.maxOutstandingCeiling < dto.minExposureFloor) {
      throw new BadRequestException(
        'maxOutstandingCeiling must be null or greater than or equal to minExposureFloor — a lower ceiling would be silently ineffective inside the exempt zone.',
      );
    }

    const row = await this.prisma.cashCollectionPolicyConfig.upsert({
      where: { vendorId },
      create: { vendorId, ...dto },
      update: { ...dto },
    });
    await this.cache.del(this.cashCacheKey(vendorId));

    await this.audit.log({
      vendorId,
      action: 'UPDATE_CASH_COLLECTION_POLICY',
      entity: 'CashCollectionPolicyConfig',
      entityId: row.id,
      changes: { after: dto },
    });

    return {
      enabled: row.enabled,
      allowedCreditDeliveries: row.allowedCreditDeliveries,
      minExposureFloor: row.minExposureFloor,
      maxOutstandingCeiling: row.maxOutstandingCeiling,
    };
  }

  /**
   * Read-only impact preview for the §8.1 settings-page rollout guard —
   * "N of your active CASH customers would owe a payment on their next
   * delivery; M of them more than ₨1,000". Evaluates the PROSPECTIVE
   * (not-yet-saved) settings against every active, non-exempt CASH
   * customer's current `financialBalance` — a single aggregate query, no
   * caching (always live, per §22.6), never written to the config table.
   *
   * Deliberately permissive about `maxOutstandingCeiling < minExposureFloor`
   * here (unlike `updateCashPolicy`): this is a best-effort live preview the
   * settings page calls on every debounced keystroke, and a transient
   * inconsistent combination while the admin is still typing must not 400 —
   * `projectCashRequiredFromBalance`'s max() is well-defined regardless.
   */
  async getCashPolicyImpact(
    vendorId: string,
    prospective: CashCollectionPolicyImpactQueryDto,
  ): Promise<{ wouldOwePayment: number; wouldOweOverThreshold: number; totalActiveCashCustomers: number }> {
    const customers = await this.prisma.customer.findMany({
      where: { vendorId, paymentType: PaymentType.CASH, isBillingExempt: false, isActive: true },
      select: { financialBalance: true },
    });

    const policy = {
      allowedCreditDeliveries: prospective.allowedCreditDeliveries,
      minExposureFloor: prospective.minExposureFloor,
      maxOutstandingCeiling: prospective.maxOutstandingCeiling ?? null,
    };

    let wouldOwePayment = 0;
    let wouldOweOverThreshold = 0;
    for (const customer of customers) {
      const required = projectCashRequiredFromBalance(policy, customer.financialBalance);
      if (required > 0) wouldOwePayment++;
      if (required > IMPACT_LARGE_REQUIREMENT_THRESHOLD) wouldOweOverThreshold++;
    }

    return {
      wouldOwePayment,
      wouldOweOverThreshold,
      totalActiveCashCustomers: customers.length,
    };
  }
}
