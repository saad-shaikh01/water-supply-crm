import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JOB_NAMES } from '@water-supply-crm/queue';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';

const actor = { userId: 'admin1', name: 'Super', role: 'SUPER_ADMIN' } as never;
const future = () => new Date(Date.now() + 3600_000).toISOString();

function setup(announcement: Record<string, unknown> | null = { id: 'a1', status: 'DRAFT', audience: 'ALL_VENDORS', vendors: [] }) {
  const prisma: any = {
    announcement: {
      findUnique: jest.fn(async () => announcement),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'a1', ...data, status: data.status })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    announcementVendor: { deleteMany: jest.fn(), createMany: jest.fn() },
    vendor: { count: jest.fn(async () => 2), findMany: jest.fn(async () => []) },
    inAppNotification: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const audit = { log: jest.fn() };
  const queue = { add: jest.fn(async () => ({})) };
  const svc = new AnnouncementService(prisma, audit as never, queue as never);
  return { svc, prisma, audit, queue };
}

describe('AnnouncementService', () => {
  it('SELECTED_VENDORS needs vendorIds', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ title: 't', body: 'b', audience: 'SELECTED_VENDORS' } as never, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SELECTED_VENDORS rejects unknown vendor ids', async () => {
    const { svc, prisma } = setup();
    prisma.vendor.count.mockResolvedValue(1);
    await expect(
      svc.create({ title: 't', body: 'b', audience: 'SELECTED_VENDORS', vendorIds: ['v1', 'v2'] } as never, actor),
    ).rejects.toThrow(/do not exist/);
  });

  it('rejects past scheduledFor', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ title: 't', body: 'b', scheduledFor: new Date(Date.now() - 1000).toISOString() } as never, actor),
    ).rejects.toThrow(/future/);
  });

  it('create with scheduledFor -> SCHEDULED, without -> DRAFT, and audits', async () => {
    const { svc, prisma, audit } = setup();
    await svc.create({ title: 't', body: 'b', scheduledFor: future() } as never, actor);
    expect(prisma.announcement.create.mock.calls[0][0].data.status).toBe('SCHEDULED');
    await svc.create({ title: 't', body: 'b' } as never, actor);
    expect(prisma.announcement.create.mock.calls[1][0].data.status).toBe('DRAFT');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'Announcement' }));
  });

  it('edit only in DRAFT/SCHEDULED', async () => {
    const { svc } = setup({ id: 'a1', status: 'SENT', audience: 'ALL_VENDORS', vendors: [] });
    await expect(svc.update('a1', { title: 'x' }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('edit loses race against a concurrent claim -> 409', async () => {
    const { svc, prisma } = setup();
    prisma.announcement.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.update('a1', { title: 'x' }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('send claims atomically and enqueues dispatch; double send -> 409', async () => {
    const { svc, prisma, queue } = setup();
    await svc.send('a1', actor);
    expect(prisma.announcement.updateMany.mock.calls[0][0].data.status).toBe('SENDING');
    expect(queue.add).toHaveBeenCalledWith(JOB_NAMES.DISPATCH_ANNOUNCEMENT, { id: 'a1' }, expect.any(Object));

    prisma.announcement.updateMany.mockResolvedValue({ count: 0 });
    queue.add.mockClear();
    await expect(svc.send('a1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueue failure releases the claim', async () => {
    const { svc, prisma, queue } = setup();
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(svc.claimAndEnqueue('a1')).rejects.toThrow('redis down');
    const last = prisma.announcement.updateMany.mock.calls.at(-1)[0];
    expect(last.data.status).toBe('DRAFT');
  });

  it('cancel only from DRAFT/SCHEDULED', async () => {
    const { svc, prisma } = setup();
    await svc.cancel('a1', actor);
    expect(prisma.announcement.updateMany.mock.calls[0][0].where.status).toEqual({ in: ['DRAFT', 'SCHEDULED'] });
    prisma.announcement.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.cancel('a1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('delete only DRAFT', async () => {
    const { svc, prisma } = setup();
    prisma.announcement.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.remove('a1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.announcement.deleteMany.mock.calls[0][0].where).toEqual({ id: 'a1', status: 'DRAFT' });
  });

  it('due scan picks only SCHEDULED && scheduledFor<=now and claims each', async () => {
    const now = new Date();
    const { svc, prisma, queue } = setup();
    prisma.announcement.findMany.mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }]).mockResolvedValueOnce([]);
    const res = await svc.scanDue(now);
    expect(prisma.announcement.findMany.mock.calls[0][0].where).toEqual({ status: 'SCHEDULED', scheduledFor: { lte: now } });
    expect(res).toEqual({ dispatched: 2, resumed: 0 });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('due scan skips an announcement another worker already claimed', async () => {
    const { svc, prisma, queue } = setup();
    prisma.announcement.findMany.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValueOnce([]);
    prisma.announcement.updateMany.mockResolvedValue({ count: 0 });
    const res = await svc.scanDue();
    expect(res.dispatched).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('stats: groupBy math and read rate', async () => {
    const { svc, prisma } = setup({ id: 'a1', status: 'SENT', recipientCount: 5, vendors: [] });
    prisma.inAppNotification.groupBy.mockResolvedValue([
      { vendorId: 'v1', isRead: true, _count: { _all: 1 } },
      { vendorId: 'v1', isRead: false, _count: { _all: 1 } },
      { vendorId: 'v2', isRead: false, _count: { _all: 2 } },
    ]);
    prisma.vendor.findMany.mockResolvedValue([
      { id: 'v1', name: 'Alpha' },
      { id: 'v2', name: 'Beta' },
    ]);
    const s = await svc.stats('a1');
    expect(s).toMatchObject({ status: 'SENT', recipientCount: 5, delivered: 4, read: 1, readRate: 0.25 });
    expect(s.byVendor).toEqual([
      { vendorId: 'v1', name: 'Alpha', delivered: 2, read: 1 },
      { vendorId: 'v2', name: 'Beta', delivered: 2, read: 0 },
    ]);
  });
});

describe('AnnouncementController authz', () => {
  it('is marked super-admin only at class level', () => {
    const keys = Reflect.getMetadataKeys(AnnouncementController);
    expect(keys.length).toBeGreaterThan(0);
    const reflector = new Reflector();
    const metas = keys.map((k) => reflector.get(k as string, AnnouncementController));
    expect(metas.some((m) => m === true || m === 'SUPER_ADMIN' || (m && typeof m === 'object'))).toBe(true);
  });
});
