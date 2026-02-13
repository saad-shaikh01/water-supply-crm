import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator
  extends HealthIndicator
  implements OnModuleInit, OnModuleDestroy
{
  private client: Redis;

  onModuleInit() {
    this.client = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
      // Short timeout so health check doesn't hang
      connectTimeout: 3000,
      commandTimeout: 3000,
      lazyConnect: true,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.client.connect().catch(() => {}); // no-op if already connected
      const pong = await this.client.ping();
      const isUp = pong === 'PONG';
      if (!isUp) {
        throw new Error('Unexpected ping response');
      }
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
