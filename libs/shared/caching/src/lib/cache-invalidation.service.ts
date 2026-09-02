import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CACHE_KEYS } from './cache-keys.constants';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  vendorKey(vendorId: string, entity: string): string {
    return `vendor:${vendorId}:${entity}`;
  }

  async invalidateVendorEntity(vendorId: string, entity: string): Promise<void> {
    const key = this.vendorKey(vendorId, entity);
    // Clear both the bare key and every suffixed variant. Paginated/filtered
    // list caches are stored under `vendor:{id}:{entity}:p:...` keys, so a plain
    // del of the bare key alone would leave those stale until their TTL expired.
    await Promise.all([
      this.cacheManager.del(key),
      this.delByPattern(`${key}:*`),
    ]);
  }

  async invalidateCustomerWallets(vendorId: string, customerId: string): Promise<void> {
    const key = `vendor:${vendorId}:${CACHE_KEYS.WALLETS}:${customerId}`;
    await this.cacheManager.del(key);
  }

  private async delByPattern(pattern: string): Promise<void> {
    try {
      const client = (this.cacheManager as any).store?.client;
      if (!client) return;

      let cursor = 0;
      const keysToDelete: string[] = [];
      do {
        const [nextCursor, keys] = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = Number(nextCursor);
        keysToDelete.push(...keys);
      } while (cursor !== 0);

      if (keysToDelete.length) await client.del(keysToDelete);
    } catch (e) {
      this.logger.warn(`Cache pattern delete failed for "${pattern}": ${(e as Error).message}`);
    }
  }

  /**
   * Invalidate all analytics cache entries for a vendor (all date ranges), plus
   * the other derived dashboard rollups that SUM DailySheet cash columns and so
   * go stale on a post-close void / delivery correction / trip correction
   * (monthly-summary, revenue, top-customers, route/staff performance). The
   * per-day dashboard key has its own date-targeted invalidation and is left
   * alone here.
   */
  async invalidateAnalytics(vendorId: string): Promise<void> {
    const base = `vendor:${vendorId}:${CACHE_KEYS.DASHBOARD}`;
    await Promise.all([
      this.delByPattern(`${base}:analytics:*`),
      this.delByPattern(`${base}:monthly-summary:*`),
      this.delByPattern(`${base}:revenue:*`),
      this.delByPattern(`${base}:top-customers:*`),
      this.delByPattern(`${base}:route-performance:*`),
      this.delByPattern(`${base}:staff-performance:*`),
    ]);
  }

  /** Invalidate the dashboard overview for a vendor. */
  async invalidateOverview(vendorId: string): Promise<void> {
    await this.cacheManager.del(this.vendorKey(vendorId, `${CACHE_KEYS.DASHBOARD}:overview`));
  }

  /** Invalidate daily dashboard cache. Pass a date string (YYYY-MM-DD) to target one day, or omit to wipe all daily caches. */
  async invalidateDailyDashboard(vendorId: string, date?: string): Promise<void> {
    if (date) {
      await this.cacheManager.del(
        this.vendorKey(vendorId, `${CACHE_KEYS.DASHBOARD}:daily:${date}`),
      );
    } else {
      await this.delByPattern(`vendor:${vendorId}:${CACHE_KEYS.DASHBOARD}:daily:*`);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }
}
