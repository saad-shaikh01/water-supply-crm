import { NotFoundException } from '@nestjs/common';
import { PlatformImportsService, STUCK_AFTER_MS } from './platform-imports.service';

describe('PlatformImportsService', () => {
  let prisma: any;
  let queue: any;
  let svc: PlatformImportsService;

  const batch = (over: Record<string, unknown> = {}) => ({
    id: 'b1', vendorId: 'v1', entity: 'CUSTOMER', status: 'FAILED', sourceFileName: 'a.xlsx', sourceFileSize: 10, rowCount: 5,
    summary: { total: 5, byAction: { create: 3 }, note: 'text', pii: ['x'] }, errorCode: 'E', errorMessage: 'oops Bearer abc', createdByName: 'Ann',
    startedAt: null, completedAt: null, createdAt: new Date(), jobId: 'j1', vendor: { name: 'Vendor' },
    sourceFileKey: 'private/key', mapping: { a: 1 }, options: { b: 2 }, ...over,
  });

  beforeEach(() => {
    prisma = { importBatch: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]), findUnique: jest.fn() } };
    queue = { getJob: jest.fn() };
    svc = new PlatformImportsService(prisma, new Map([['vendor-import', queue]]) as any);
  });

  it('filters + pagination, selects an allow-list (never sourceFileKey/mapping/options)', async () => {
    await svc.list({ vendorId: 'v1', status: 'FAILED' as any, entity: 'CUSTOMER' as any, from: '2026-01-01', to: '2026-01-02', page: 3, limit: 5 });
    const a = prisma.importBatch.findMany.mock.calls[0][0];
    expect(a.where).toMatchObject({ vendorId: 'v1', status: 'FAILED', entity: 'CUSTOMER' });
    expect(a.where.createdAt.lte.toISOString()).toBe('2026-01-02T23:59:59.999Z');
    expect(a.skip).toBe(10);
    for (const k of ['sourceFileKey', 'mapping', 'options', 'rows']) expect(Object.keys(a.select)).not.toContain(k);
  });

  it('serializer returns counters only and redacts the message even if the row had extra fields', async () => {
    prisma.importBatch.findMany.mockResolvedValue([batch()]);
    prisma.importBatch.count.mockResolvedValue(1);
    const res = await svc.list({});
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/private\/key|"mapping"|"options"|abc/);
    expect(res.data[0].summary).toEqual({ total: 5, 'byAction.create': 3 });
    expect(res.data[0].vendorName).toBe('Vendor');
  });

  it('stats: 7-day counts by status and stuck query (statuses + updatedAt < now-30m)', async () => {
    prisma.importBatch.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 4 } }]);
    prisma.importBatch.count.mockResolvedValue(2);
    const before = Date.now();
    const r = await svc.stats();
    expect(r).toEqual({ last7d: { COMPLETED: 4 }, stuck: 2 });
    const w = prisma.importBatch.count.mock.calls[0][0].where;
    expect(w.status.in).toEqual(['QUEUED', 'EXECUTING', 'PLANNING']);
    expect(w.updatedAt.lt.getTime()).toBeLessThanOrEqual(before - STUCK_AFTER_MS + 1000);
  });

  it('findOne adds queueState; tolerates missing job / queue error; 404 when missing', async () => {
    prisma.importBatch.findUnique.mockResolvedValue(batch());
    queue.getJob.mockResolvedValue({ getState: async () => 'failed', attemptsMade: 2, failedReason: 'x' });
    expect((await svc.findOne('b1')).queueState).toEqual({ state: 'failed', attemptsMade: 2, failedReason: 'x' });
    queue.getJob.mockResolvedValue(null);
    expect((await svc.findOne('b1')).queueState).toBeNull();
    queue.getJob.mockRejectedValue(new Error('redis down'));
    expect((await svc.findOne('b1')).queueState).toBeNull();
    prisma.importBatch.findUnique.mockResolvedValue(null);
    await expect(svc.findOne('zz')).rejects.toBeInstanceOf(NotFoundException);
  });
});
