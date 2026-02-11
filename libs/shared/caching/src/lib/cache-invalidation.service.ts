import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CACHE_KEYS } from './cache-keys.constants';

@Injectable()
export class CacheInvalidationService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  vendorKey(vendorId: string, entity: string): string {
    return `vendor:${vendorId}:${entity}`;
  }

  async invalidateVendorEntity(vendorId: string, entity: string): Promise<void> {
    const key = this.vendorKey(vendorId, entity);
    await this.cacheManager.del(key);
  }

  async invalidateCustomerWallets(vendorId: string, customerId: string): Promise<void> {
    const key = `vendor:${vendorId}:${CACHE_KEYS.WALLETS}:${customerId}`;
    await this.cacheManager.del(key);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }
}
