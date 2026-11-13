import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';

export type LimitedResource = 'CUSTOMER' | 'DRIVER' | 'VAN';

/** Redis key holding a vendor's resolved plan limits (60s TTL; invalidated on any billing change). */
export const planLimitsKey = (vendorId: string) => `vendor:${vendorId}:plan-limits`;
const PLAN_LIMITS_TTL_MS = 60_000;

export interface EffectiveLimits {
  planName: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  /** null = unlimited */
  maxCustomers: number | null;
  maxDrivers: number | null;
  maxVans: number | null;
}

/** Cached wrapper so "no subscription" (null) can be told apart from a cache miss. */
interface CachedLimits {
  limits: EffectiveLimits | null;
}

const LIMIT_FIELD: Record<LimitedResource, 'maxCustomers' | 'maxDrivers' | 'maxVans'> = {
  CUSTOMER: 'maxCustomers',
  DRIVER: 'maxDrivers',
  VAN: 'maxVans',
};

@Injectable()
export class PlanLimitService {
  private readonly logger = new Logger(PlanLimitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  /** null = no subscription => unlimited (grandfathered, assumption A2). Overrides beat plan values. */
  async getEffectiveLimits(vendorId: string): Promise<EffectiveLimits | null> {
    const key = planLimitsKey(vendorId);
    const cached = await this.cache.get<CachedLimits>(key);
    if (cached && typeof cached === 'object' && 'limits' in cached) return cached.limits;

    const sub = await this.prisma.vendorSubscription.findUnique({
      where: { vendorId },
      include: { plan: true },
    });
    const limits: EffectiveLimits | null = sub
      ? {
          planName: sub.plan.name,
          status: sub.status,
          maxCustomers: sub.overrideMaxCustomers ?? sub.plan.maxCustomers,
          maxDrivers: sub.overrideMaxDrivers ?? sub.plan.maxDrivers,
          maxVans: sub.overrideMaxVans ?? sub.plan.maxVans,
        }
      : null;
    await this.cache.set(key, { limits } satisfies CachedLimits, PLAN_LIMITS_TTL_MS);
    return limits;
  }

  async invalidate(vendorId: string): Promise<void> {
    try {
      await this.cache.del(planLimitsKey(vendorId));
    } catch (e) {
      this.logger.warn(`Could not invalidate plan limits cache for vendor ${vendorId}: ${(e as Error).message}`);
    }
  }

  async getUsage(vendorId: string): Promise<{ customers: number; drivers: number; vans: number }> {
    const [customers, drivers, vans] = await Promise.all([
      this.prisma.customer.count({ where: { vendorId, isActive: true } }), // D11
      this.prisma.user.count({ where: { vendorId, role: UserRole.DRIVER, isActive: true, isSystem: false } }),
      this.prisma.van.count({ where: { vendorId, isActive: true } }),
    ]);
    return { customers, drivers, vans };
  }

  private async countFor(vendorId: string, resource: LimitedResource): Promise<number> {
    const usage = await this.getUsage(vendorId);
    return resource === 'CUSTOMER' ? usage.customers : resource === 'DRIVER' ? usage.drivers : usage.vans;
  }

  /**
   * Throws 403 PLAN_LIMIT_REACHED / SUBSCRIPTION_INACTIVE when creating `adding` more `resource`
   * would break the vendor's plan. FAILS OPEN: any infrastructure error while looking limits up is
   * logged and the create is allowed — billing code must never block a vendor's business.
   */
  async assertCanCreate(vendorId: string | null | undefined, resource: LimitedResource, adding = 1): Promise<void> {
    if (!vendorId) return;

    let limits: EffectiveLimits | null;
    try {
      limits = await this.getEffectiveLimits(vendorId);
    } catch (e) {
      this.logger.error(`Plan limit lookup failed for vendor ${vendorId} (allowing): ${(e as Error).message}`);
      return;
    }
    if (!limits) return; // no subscription: unlimited

    if (limits.status === 'PAST_DUE' || limits.status === 'CANCELLED') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'SUBSCRIPTION_INACTIVE',
        status: limits.status,
        planName: limits.planName,
        message: `Your subscription is ${limits.status === 'PAST_DUE' ? 'past due' : 'cancelled'}. Please contact support to continue adding records.`,
      });
    }

    const limit = limits[LIMIT_FIELD[resource]];
    if (limit == null) return;

    let used: number;
    try {
      used = await this.countFor(vendorId, resource);
    } catch (e) {
      this.logger.error(`Plan usage count failed for vendor ${vendorId} (allowing): ${(e as Error).message}`);
      return;
    }

    if (used + adding > limit) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'PLAN_LIMIT_REACHED',
        resource,
        limit,
        used,
        planName: limits.planName,
        message: `Your ${limits.planName} plan allows up to ${limit} ${resource.toLowerCase()}s and you already have ${used}. Upgrade your plan to add more.`,
      });
    }
  }
}
