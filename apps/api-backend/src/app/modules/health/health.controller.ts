import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  /**
   * GET /api/health
   * Full health check — used by Docker/K8s liveness + readiness probes.
   * Returns 200 if all checks pass, 503 if any fail.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // 1. PostgreSQL database
      () => this.prismaIndicator.isHealthy('database'),

      // 2. Redis (caching + queues + tracking)
      () => this.redisIndicator.isHealthy('redis'),

      // 3. Memory — alert if heap exceeds 500 MB
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),

      // 4. Disk — alert if usage exceeds 90%
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  /**
   * GET /api/health/live
   * Liveness probe — just confirms the process is alive.
   * Does NOT check DB/Redis — used by K8s to decide if pod needs restart.
   */
  @Get('live')
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * GET /api/health/ready
   * Readiness probe — checks DB + Redis are reachable.
   * Used by K8s to decide if pod should receive traffic.
   */
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }
}
