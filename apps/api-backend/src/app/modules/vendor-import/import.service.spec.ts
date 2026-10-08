import type { AuthUser } from '@water-supply-crm/types';
import { ImportService } from './import.service';

const user = { userId: 'u1', name: 'Admin', vendorId: 'v1', email: 'a@b.c', role: 'VENDOR_ADMIN', customerId: null } as unknown as AuthUser;

function build(batch: Record<string, unknown> | null, extra: { other?: boolean; dup?: boolean; claimed?: number } = {}) {
  const prisma = {
    importBatch: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // tenancy: a batch is only visible to its own vendor
        if (where['id'] && typeof where['id'] === 'string') return batch && batch['vendorId'] === where['vendorId'] ? batch : null;
        if (where['sourceFileSha256']) return extra.dup ? { id: 'old' } : null;
        return extra.other ? { id: 'other' } : null;
      }),
      updateMany: jest.fn(async () => ({ count: extra.claimed ?? 1 })),
      update: jest.fn(async () => ({})),
    },
  };
  const queue = { add: jest.fn(async () => ({ id: 'job-1' })) };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new ImportService(prisma as never, {} as never, audit as never, {} as never, queue as never);
  return { svc, prisma, queue, audit };
}

const mapped = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  vendorId: 'v1',
  entity: 'CUSTOMERS_OPENING',
  status: 'MAPPED',
  planHash: 'hash-1',
  sourceFileSha256: 'sha',
  updatedAt: new Date(),
  summary: { plan: { create: 10, rowsWithWarnings: 0 } },
  ...over,
});
const dto = (over: Record<string, unknown> = {}) => ({ planHash: 'hash-1', acknowledgeWarnings: false, ...over }) as never;

describe('ImportService.execute guards', () => {
  it('enqueues exactly once on the happy path and claims the batch atomically', async () => {
    const { svc, queue, prisma } = build(mapped());
    await expect(svc.execute(user, 'b1', dto())).resolves.toMatchObject({ status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(prisma.importBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) }));
  });
  it('is tenant-scoped: another vendor cannot execute (or even see) the batch', async () => {
    const { svc, queue } = build(mapped({ vendorId: 'v2' }));
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('rejects a stale plan hash', async () => {
    const { svc, queue } = build(mapped());
    await expect(svc.execute(user, 'b1', dto({ planHash: 'old' }))).rejects.toMatchObject({ code: 'PLAN_STALE', status: 409 });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('requires warnings to be acknowledged', async () => {
    const { svc } = build(mapped({ summary: { plan: { create: 5, rowsWithWarnings: 2 } } }));
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'WARNINGS_NOT_ACKNOWLEDGED' });
    await expect(svc.execute(user, 'b1', dto({ acknowledgeWarnings: true }))).resolves.toBeDefined();
  });
  it('refuses an empty plan', async () => {
    const { svc } = build(mapped({ summary: { plan: { create: 0, rowsWithWarnings: 0 } } }));
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'NOTHING_TO_IMPORT' });
  });
  it('asks for acknowledgement when the exact file was already imported', async () => {
    const { svc } = build(mapped(), { dup: true });
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'DUPLICATE_FILE', status: 409 });
    await expect(svc.execute(user, 'b1', dto({ acknowledgeDuplicateFile: true }))).resolves.toBeDefined();
  });
  it('allows only one running import per vendor', async () => {
    const { svc, queue } = build(mapped(), { other: true });
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'IMPORT_ALREADY_RUNNING' });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('loses the race gracefully when another request already claimed the batch', async () => {
    const { svc, queue } = build(mapped(), { claimed: 0 });
    await expect(svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'IMPORT_ALREADY_RUNNING' });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('a running batch cannot be started again, but a dead one (stale heartbeat) can be resumed without a hash', async () => {
    const live = build(mapped({ status: 'EXECUTING' }));
    await expect(live.svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'IMPORT_ALREADY_RUNNING' });
    const dead = build(mapped({ status: 'EXECUTING', updatedAt: new Date(Date.now() - 10 * 60 * 1000) }));
    await expect(dead.svc.execute(user, 'b1', dto({ planHash: 'whatever' }))).resolves.toMatchObject({ status: 'QUEUED' });
    const failed = build(mapped({ status: 'FAILED' }));
    await expect(failed.svc.execute(user, 'b1', dto({ planHash: '' }))).resolves.toBeDefined();
  });
  it('a finished batch that still has FAILED rows can be retried (Resume), without a plan hash', async () => {
    const { svc, queue } = build(mapped({ status: 'COMPLETED_WITH_ERRORS' }));
    await expect(svc.execute(user, 'b1', dto({ planHash: '' }))).resolves.toMatchObject({ status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
  it('cannot run a draft that was never mapped, or a fully completed import', async () => {
    const draft = build(mapped({ status: 'UPLOADED' }));
    await expect(draft.svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'NOT_EXECUTABLE' });
    const done = build(mapped({ status: 'COMPLETED' }));
    await expect(done.svc.execute(user, 'b1', dto())).rejects.toMatchObject({ code: 'NOT_EXECUTABLE' });
  });
});
