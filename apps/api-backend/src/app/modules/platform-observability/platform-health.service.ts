import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '@water-supply-crm/database';
import { CRON_REGISTRY, CronMeta } from './cron-registry';
import { OBSERVED_QUEUE_NAMES, PLATFORM_QUEUES } from './queue-registry';
import { redactText } from './redact.util';

export const PLATFORM_REDIS = 'PLATFORM_OBSERVABILITY_REDIS';
export const HEALTH_CACHE_TTL_MS = 30_000;
export const REFRESH_LIMIT_PER_MIN = 6;
export const CHECK_TIMEOUT_MS = 2_000;
const MB = 1024 * 1024;

export function redisClientFactory(): Redis {
  const client = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
    connectTimeout: 2000,
    commandTimeout: 2000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined); // never crash the process on a Redis outage
  return client;
}

function withTimeout<T>(p: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error('timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class PlatformHealthService implements OnModuleDestroy {
  private cache: { at: number; value: any } | null = null;
  private readonly startedAt = new Date();
  private refreshes: number[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_QUEUES) private readonly queues: Map<string, Queue>,
    @Inject(PLATFORM_REDIS) private readonly redis: Redis,
  ) {}

  onModuleDestroy() {
    try {
      this.redis.disconnect();
    } catch {
      /* ignore */
    }
  }

  async getHealth(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.cache.at < HEALTH_CACHE_TTL_MS) {
      return { ...this.cache.value, cached: true };
    }
    if (refresh) {
      const now = Date.now();
      this.refreshes = this.refreshes.filter((t) => now - t < 60_000);
      if (this.refreshes.length >= REFRESH_LIMIT_PER_MIN) throw new HttpException('Too many refresh requests, try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
      this.refreshes.push(now);
    }
    const [database, redis, queues, crons, whatsapp] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueues(),
      this.checkCrons(),
      this.checkWhatsapp(),
    ]);
    const value = { generatedAt: new Date().toISOString(), cached: false, api: this.apiInfo(), database, redis, queues, crons, whatsapp };
    this.cache = { at: Date.now(), value };
    return value;
  }

  private apiInfo() {
    const mem = process.memoryUsage();
    return {
      status: 'up' as const,
      version: process.env['APP_VERSION'] || process.env['npm_package_version'] || 'unknown',
      gitSha: process.env['GIT_SHA'] || null,
      nodeEnv: process.env['NODE_ENV'] || 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: this.startedAt.toISOString(),
      memory: { rssMb: round1(mem.rss / MB), heapUsedMb: round1(mem.heapUsed / MB) },
    };
  }

  private async checkDatabase() {
    const t0 = Date.now();
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return { status: 'up' as const, latencyMs: Date.now() - t0 };
    } catch {
      return { status: 'down' as const, latencyMs: null };
    }
  }

  private async checkRedis() {
    const t0 = Date.now();
    try {
      if (this.redis.status !== 'ready') await withTimeout(this.redis.connect().catch((e: Error) => { if (this.redis.status !== 'ready') throw e; }));
      await withTimeout(this.redis.ping());
    } catch {
      return { status: 'down' as const, latencyMs: null, usedMemoryMb: null, maxmemoryPolicy: null, policyOk: null };
    }
    const latencyMs = Date.now() - t0;
    let usedMemoryMb: number | null = null;
    let maxmemoryPolicy: string | null = null;
    try {
      const info = await withTimeout(this.redis.info('memory'));
      const m = /used_memory:(\d+)/.exec(info);
      if (m) usedMemoryMb = round1(Number(m[1]) / MB);
    } catch {
      /* INFO may be disabled */
    }
    try {
      const cfg = (await withTimeout(this.redis.config('GET', 'maxmemory-policy'))) as unknown as string[];
      if (Array.isArray(cfg) && typeof cfg[1] === 'string') maxmemoryPolicy = cfg[1];
    } catch {
      /* CONFIG is often disabled on managed Redis */
    }
    return { status: 'up' as const, latencyMs, usedMemoryMb, maxmemoryPolicy, policyOk: maxmemoryPolicy === null ? null : maxmemoryPolicy === 'noeviction' };
  }

  private async checkQueues() {
    const results = await Promise.allSettled(
      OBSERVED_QUEUE_NAMES.map(async (name) => {
        const q = this.queues.get(name);
        if (!q) throw new Error('not registered');
        const [counts, paused] = await withTimeout(Promise.all([q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused'), q.isPaused()]));
        return {
          name,
          status: 'ok' as const,
          paused,
          counts: { waiting: counts['waiting'] ?? 0, active: counts['active'] ?? 0, delayed: counts['delayed'] ?? 0, failed: counts['failed'] ?? 0, completed: counts['completed'] ?? 0 },
        };
      }),
    );
    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { name: OBSERVED_QUEUE_NAMES[i], status: 'unknown' as const, paused: null, counts: null }));
  }

  private async checkCrons() {
    // One scheduler listing + one history fetch per distinct queue.
    const byQueue = new Map<string, CronMeta[]>();
    for (const c of CRON_REGISTRY) byQueue.set(c.queue, [...(byQueue.get(c.queue) ?? []), c]);

    const perQueue = await Promise.all(
      [...byQueue.entries()].map(async ([queueName, metas]) => {
        const q = this.queues.get(queueName);
        try {
          if (!q) throw new Error('not registered');
          const [schedulers, repeatables, history] = await withTimeout(
            Promise.all([
              (q as any).getJobSchedulers ? q.getJobSchedulers(0, 100, true) : Promise.resolve([]),
              q.getRepeatableJobs(0, 100, true),
              q.getJobs(['completed', 'failed'], 0, 99, false),
            ]),
          );
          return metas.map((m) => this.cronStatus(m, schedulers as any[], repeatables as any[], history as any[]));
        } catch {
          return metas.map((m) => ({ jobId: m.jobId, queue: m.queue, label: m.label, pattern: m.pattern, tz: m.tz, registered: null, nextRunAt: null, lastRun: null, status: 'unknown' as const }));
        }
      }),
    );
    const flat = perQueue.flat();
    // keep registry order
    return CRON_REGISTRY.map((m) => flat.find((c) => c.jobId === m.jobId)!);
  }

  private cronStatus(m: CronMeta, schedulers: any[], repeatables: any[], history: any[]) {
    const sched = schedulers.find((s) => s?.key === m.jobId || s?.id === m.jobId);
    const rep = repeatables.find((r) => r?.id === m.jobId || r?.key?.includes?.(m.jobId));
    const found = sched ?? rep;
    const next = found?.next ?? null;
    const legacyName: string | undefined = rep?.name;
    const mine = history.filter(
      (j) => j && (j.repeatJobKey === m.jobId || (typeof j.id === 'string' && j.id.startsWith(`repeat:${m.jobId}:`)) || (!sched && legacyName && j.name === legacyName)),
    );
    let last: any = null;
    for (const j of mine) if (j.finishedOn && (!last || j.finishedOn > last.finishedOn)) last = j;
    return {
      jobId: m.jobId,
      queue: m.queue,
      label: m.label,
      pattern: found?.pattern ?? m.pattern,
      tz: found?.tz ?? m.tz,
      registered: !!found,
      nextRunAt: next ? new Date(Number(next)).toISOString() : null,
      lastRun: last
        ? {
            status: last.failedReason ? ('failed' as const) : ('completed' as const),
            finishedAt: new Date(last.finishedOn).toISOString(),
            durationMs: last.processedOn ? last.finishedOn - last.processedOn : null,
            failedReason: last.failedReason ? redactText(last.failedReason) : null,
          }
        : null,
      status: 'ok' as const,
    };
  }

  private async checkWhatsapp() {
    const enabled = process.env['WHATSAPP_ENABLED'] === 'true';
    try {
      const [accountsTotal, accountsInvalid] = await withTimeout(
        Promise.all([this.prisma.whatsAppAccount.count(), this.prisma.whatsAppAccount.count({ where: { status: 'TOKEN_INVALID' } })]),
      );
      return { enabled, accountsTotal, accountsInvalid };
    } catch {
      return { enabled, accountsTotal: null, accountsInvalid: null };
    }
  }

  /** Sanitised failed-job sample for one whitelisted queue. Never includes job data or stack traces. */
  async getFailedJobs(name: string, limit = 10) {
    if (!OBSERVED_QUEUE_NAMES.includes(name)) throw new NotFoundException('Unknown queue');
    const q = this.queues.get(name);
    if (!q) throw new NotFoundException('Unknown queue');
    const n = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
    let jobs: any[] = [];
    try {
      jobs = await withTimeout(q.getFailed(0, n - 1));
    } catch {
      jobs = [];
    }
    return {
      queue: name,
      jobs: jobs.map((j) => ({
        id: j.id ?? null,
        name: j.name,
        attemptsMade: j.attemptsMade ?? 0,
        failedReason: redactText(j.failedReason),
        timestamp: j.timestamp ?? null,
        finishedOn: j.finishedOn ?? null,
      })),
    };
  }
}
