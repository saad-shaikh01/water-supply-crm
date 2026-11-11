import { AnnouncementDispatchService, DISPATCH_CHUNK_SIZE } from './announcement-dispatch.service';

function users(n: number, vendorId = 'v1', prefix = 'u') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, vendorId }));
}

function setup(opts: { announcement?: any; recipients?: any[]; existing?: any[] } = {}) {
  const prisma: any = {
    announcement: {
      findUnique: jest.fn(async () =>
        opts.announcement === undefined
          ? { id: 'a1', status: 'SENDING', audience: 'ALL_VENDORS', severity: 'INFO', title: 'T', body: 'B', vendors: [] }
          : opts.announcement,
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    user: { findMany: jest.fn(async () => opts.recipients ?? []) },
    inAppNotification: { findMany: jest.fn(async () => opts.existing ?? []) },
  };
  const inApp = { createMany: jest.fn(async (d: any[]) => ({ count: d.length })) };
  return { svc: new AnnouncementDispatchService(prisma, inApp as never), prisma, inApp };
}

describe('AnnouncementDispatchService', () => {
  it('queries only active VENDOR_ADMINs of active vendors (no customers/drivers)', async () => {
    const { svc, prisma } = setup({ recipients: users(2) });
    await svc.dispatch('a1');
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      role: 'VENDOR_ADMIN',
      isActive: true,
      vendorId: { not: null },
      vendor: { isActive: true },
    });
  });

  it('SELECTED_VENDORS restricts to target vendors', async () => {
    const { svc, prisma } = setup({
      announcement: {
        id: 'a1', status: 'SENDING', audience: 'SELECTED_VENDORS', severity: 'INFO', title: 'T', body: 'B',
        vendors: [{ vendorId: 'v1' }, { vendorId: 'v3' }],
      },
    });
    await svc.dispatch('a1');
    expect(prisma.user.findMany.mock.calls[0][0].where.vendorId).toEqual({ in: ['v1', 'v3'] });
  });

  it('1,200 recipients -> 3 createMany chunks, SENT with recipientCount', async () => {
    const { svc, prisma, inApp } = setup({ recipients: users(1200) });
    const res = await svc.dispatch('a1');
    expect(DISPATCH_CHUNK_SIZE).toBe(500);
    expect(inApp.createMany.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(res).toEqual({ created: 1200, total: 1200 });
    const upd = prisma.announcement.updateMany.mock.calls.at(-1)[0];
    expect(upd.data).toMatchObject({ status: 'SENT', recipientCount: 1200 });
  });

  it('rows carry type, entityId, vendorId, body and severity prefix', async () => {
    const { svc, inApp } = setup({
      announcement: { id: 'a1', status: 'SENDING', audience: 'ALL_VENDORS', severity: 'CRITICAL', title: 'Outage', body: 'Body', vendors: [] },
      recipients: users(1),
    });
    await svc.dispatch('a1');
    expect(inApp.createMany.mock.calls[0][0][0]).toEqual({
      userId: 'u0', vendorId: 'v1', type: 'PLATFORM_ANNOUNCEMENT', title: '[Critical] Outage', message: 'Body', entityId: 'a1',
    });
  });

  it('resume after partial failure creates no duplicates', async () => {
    // Previous attempt already delivered u0..u499.
    const { svc, inApp } = setup({ recipients: users(700), existing: users(500).map((u) => ({ userId: u.id })) });
    const res = await svc.dispatch('a1');
    expect(inApp.createMany.mock.calls.map((c) => c[0].length)).toEqual([200]);
    expect(inApp.createMany.mock.calls[0][0].some((r: any) => Number(r.userId.slice(1)) < 500)).toBe(false);
    expect(res).toEqual({ created: 200, total: 700 });
  });

  it('chunk failure records lastError, keeps SENDING, rethrows for retry', async () => {
    const { svc, prisma, inApp } = setup({ recipients: users(600) });
    inApp.createMany.mockResolvedValueOnce({ count: 500 }).mockRejectedValueOnce(new Error('db down'));
    await expect(svc.dispatch('a1')).rejects.toThrow('db down');
    const upd = prisma.announcement.updateMany.mock.calls.at(-1)[0];
    expect(upd.data).toEqual({ lastError: 'db down' });
  });

  it('does nothing unless status is SENDING (cancelled/sent/double job)', async () => {
    for (const status of ['SENT', 'CANCELLED', 'DRAFT']) {
      const { svc, inApp } = setup({ announcement: { id: 'a1', status, vendors: [] }, recipients: users(3) });
      expect(await svc.dispatch('a1')).toBeNull();
      expect(inApp.createMany).not.toHaveBeenCalled();
    }
  });

  it('markFailed only transitions SENDING -> FAILED', async () => {
    const { svc, prisma } = setup();
    await svc.markFailed('a1', 'boom');
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'SENDING' },
      data: { status: 'FAILED', lastError: 'boom' },
    });
  });
});
