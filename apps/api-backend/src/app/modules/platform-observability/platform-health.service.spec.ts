import { HttpException, NotFoundException } from '@nestjs/common';
import { PlatformHealthService, REFRESH_LIMIT_PER_MIN } from './platform-health.service';
import { OBSERVED_QUEUE_NAMES } from './queue-registry';
import { CRON_REGISTRY } from './cron-registry';

function makeQueue(over: Record<string, any> = {}) {
  return {
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5, paused: 0 }),
    isPaused: jest.fn().mockResolvedValue(false),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    getJobs: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('PlatformHealthService', () => {
  let prisma: any;
  let redis: any;
  let queues: Map<string, any>;
  let svc: PlatformHealthService;
  const saved = { ...process.env };

  beforeEach(() => {
    process.env['REDIS_URL'] = 'redis://sentinel-user:sentinel-pass@sentinel-host:6379';
    process.env['DATABASE_URL'] = 'postgres://sentinel-db-user:sentinel-db-pass@db-host/x';
    process.env['META_WA_ACCESS_TOKEN'] = 'EAAB-sentinel-token';
    prisma = { $queryRaw: jest.fn().mockResolvedValue([1]), whatsAppAccount: { count: jest.fn().mockResolvedValue(2) } };
    redis = {
      status: 'ready',
      connect: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      info: jest.fn().mockResolvedValue('used_memory:10485760\r\n'),
      config: jest.fn().mockResolvedValue(['maxmemory-policy', 'noeviction']),
      disconnect: jest.fn(),
    };
    queues = new Map(OBSERVED_QUEUE_NAMES.map((n) => [n, makeQueue()]));
    svc = new PlatformHealthService(prisma, queues as any, redis);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('aggregates 12 queues, all 8 crons, db, redis', async () => {
    const h = await svc.getHealth();
    expect(h.queues).toHaveLength(12);
    expect(h.queues[0]).toMatchObject({ status: 'ok', counts: { waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 } });
    expect(h.crons).toHaveLength(CRON_REGISTRY.length);
    expect(h.database.status).toBe('up');
    expect(h.redis).toMatchObject({ status: 'up', usedMemoryMb: 10, maxmemoryPolicy: 'noeviction', policyOk: true });
    expect(h.cached).toBe(false);
  });

  it('one broken queue -> unknown, others fine, no throw', async () => {
    queues.set(OBSERVED_QUEUE_NAMES[0], makeQueue({ getJobCounts: jest.fn().mockRejectedValue(new Error('boom')) }));
    const h = await svc.getHealth();
    expect(h.queues[0]).toMatchObject({ status: 'unknown', counts: null });
    expect(h.queues[1].status).toBe('ok');
  });

  it('redis ping failure -> down with partial data; CONFIG failure -> null policy', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    let h = await svc.getHealth(true);
    expect(h.redis.status).toBe('down');
    redis.ping.mockResolvedValue('PONG');
    redis.config.mockRejectedValue(new Error('disabled'));
    h = await svc.getHealth(true);
    expect(h.redis).toMatchObject({ status: 'up', maxmemoryPolicy: null, policyOk: null });
  });

  it('db failure -> database down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('x'));
    expect((await svc.getHealth()).database.status).toBe('down');
  });

  it('merges job schedulers and repeatables; missing -> registered:false; lastRun from latest finished job', async () => {
    const sheetQ = makeQueue({
      getJobSchedulers: jest.fn().mockResolvedValue([{ key: 'daily-sheet-auto-generation', pattern: '5 0 * * *', tz: 'Asia/Karachi', next: 1_800_000_000_000 }]),
      getJobs: jest.fn().mockResolvedValue([
        { id: 'repeat:daily-sheet-auto-generation:1', repeatJobKey: 'daily-sheet-auto-generation', processedOn: 1000, finishedOn: 3000 },
        { id: 'repeat:daily-sheet-auto-generation:2', repeatJobKey: 'daily-sheet-auto-generation', processedOn: 5000, finishedOn: 5500, failedReason: 'Bearer abcdef broke' },
      ]),
    });
    const payQ = makeQueue({ getRepeatableJobs: jest.fn().mockResolvedValue([{ key: 'hash123', name: 'send-payment-reminders', pattern: '0 5 * * *', next: 1_800_000_000_000 }]) });
    queues.set('daily-sheet-generation', sheetQ);
    queues.set('payment-reminders', payQ);
    const h = await svc.getHealth();
    const sheet = h.crons.find((c: any) => c.jobId === 'daily-sheet-auto-generation')!;
    expect(sheet.registered).toBe(true);
    expect(sheet.nextRunAt).toBe(new Date(1_800_000_000_000).toISOString());
    expect(sheet.lastRun).toMatchObject({ status: 'failed', durationMs: 500 });
    expect(JSON.stringify(sheet.lastRun)).not.toContain('abcdef');
    expect(h.crons.find((c: any) => c.jobId === 'payment-reminder-daily')!.registered).toBe(true);
    expect(h.crons.find((c: any) => c.jobId === 'fleet-notification-sweep')!.registered).toBe(false);
    expect(h.crons.find((c: any) => c.jobId === 'fleet-notification-sweep')!.lastRun).toBeNull();
  });

  it('caches 30s (no queue calls on second call); refresh bypasses; refresh is rate limited', async () => {
    await svc.getHealth();
    const calls = queues.get(OBSERVED_QUEUE_NAMES[0]).getJobCounts.mock.calls.length;
    const again = await svc.getHealth();
    expect(again.cached).toBe(true);
    expect(queues.get(OBSERVED_QUEUE_NAMES[0]).getJobCounts.mock.calls.length).toBe(calls);
    for (let i = 0; i < REFRESH_LIMIT_PER_MIN; i++) await svc.getHealth(true);
    await expect(svc.getHealth(true)).rejects.toBeInstanceOf(HttpException);
  });

  it('response never contains env values, urls or secrets', async () => {
    const json = JSON.stringify(await svc.getHealth());
    for (const s of ['sentinel-pass', 'sentinel-host', 'sentinel-db-pass', 'EAAB-sentinel-token']) expect(json).not.toContain(s);
  });

  it('failed jobs: unknown queue 404; no data/stacktrace; reason truncated + redacted', async () => {
    await expect(svc.getFailedJobs('nope')).rejects.toBeInstanceOf(NotFoundException);
    queues.set('notifications', makeQueue({
      getFailed: jest.fn().mockResolvedValue([{ id: '1', name: 'n', data: { phone: '+92300' }, stacktrace: ['at x'], attemptsMade: 3, failedReason: 'Bearer secret123 ' + 'x'.repeat(400), timestamp: 1, finishedOn: 2 }]),
    }));
    const r = await svc.getFailedJobs('notifications', 5);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/phone|stacktrace|secret123|at x/);
    expect(r.jobs[0].failedReason!.length).toBeLessThanOrEqual(300);
    expect(Object.keys(r.jobs[0]).sort()).toEqual(['attemptsMade', 'failedReason', 'finishedOn', 'id', 'name', 'timestamp']);
  });
});
