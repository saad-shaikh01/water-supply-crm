import { ForbiddenException } from '@nestjs/common';
import { CashLedgerPeriodGuard } from './cash-ledger-period.guard';
import { CashLedgerPeriodStore } from './cash-ledger-period.store';
import { runWithLockOverrideContext } from '../../common/request-context/lock-override.context';

const VENDOR_ID = 'vendor-001';
const GOOD_REASON = 'Correcting a mis-dated fuel top-up';

/** Store backed by a fixed CLOSED set (the real store class over a mock prisma). */
function build(opts: { closed?: string[]; canOverride?: boolean } = {}) {
  const prisma = {
    cashLedgerPeriod: {
      findMany: jest
        .fn()
        // store.getClosedLabels
        .mockImplementation(async (args: { where: { status?: string; periodLabel?: { in: string[] } } }) => {
          if (args.where.status === 'CLOSED') return (opts.closed ?? []).map((periodLabel) => ({ periodLabel }));
          // guard's id lookup
          return (args.where.periodLabel?.in ?? []).map((periodLabel) => ({ id: `id-${periodLabel}`, periodLabel }));
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const permissions = { can: jest.fn().mockResolvedValue(opts.canOverride ?? false) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const store = new CashLedgerPeriodStore(prisma as never);
  const guard = new CashLedgerPeriodGuard(store, permissions as never, prisma as never, audit as never);
  return { guard, prisma, permissions, audit };
}

async function rejection(p: Promise<unknown>): Promise<ForbiddenException> {
  try {
    await p;
  } catch (e) {
    return e as ForbiddenException;
  }
  throw new Error('expected rejection');
}

describe('CashLedgerPeriodGuard.assertWritable', () => {
  it('passes untouched when every date is in an open period (no permission lookup, no writes)', async () => {
    const { guard, permissions, prisma, audit } = build({ closed: ['2026-08'] });
    await expect(guard.assertWritable(VENDOR_ID, ['2026-09-03', new Date('2026-09-10T00:00:00Z'), null, undefined])).resolves.toBeUndefined();
    expect(permissions.can).not.toHaveBeenCalled();
    expect(prisma.cashLedgerPeriod.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('closed period + no request context (script / job) -> 403 PERIOD_CLOSED, canOverride false', async () => {
    const { guard, permissions } = build({ closed: ['2026-08'], canOverride: true });
    const err = await rejection(guard.assertWritable(VENDOR_ID, ['2026-08-15']));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({
      statusCode: 403,
      code: 'PERIOD_CLOSED',
      periods: ['2026-08'],
      canOverride: false,
    });
    expect((err.getResponse() as { message: string }).message).toContain('Aug 2026');
    // never even asks for permissions without a user
    expect(permissions.can).not.toHaveBeenCalled();
  });

  it('a request user WITHOUT override_lock -> canOverride false, even with a valid reason', async () => {
    const { guard, permissions } = build({ closed: ['2026-08'], canOverride: false });
    const err = await rejection(
      runWithLockOverrideContext({ req: { user: { userId: 'mgr-1' } }, overrideReason: GOOD_REASON }, () =>
        guard.assertWritable(VENDOR_ID, ['2026-08-15']),
      ),
    );
    expect(err.getResponse()).toMatchObject({ code: 'PERIOD_CLOSED', canOverride: false });
    expect(permissions.can).toHaveBeenCalledWith('mgr-1', 'van_cash_ledger:override_lock');
  });

  it('admin WITHOUT a reason -> 403 with canOverride true and a "provide a reason" message', async () => {
    const { guard, prisma, audit } = build({ closed: ['2026-08'], canOverride: true });
    const err = await rejection(
      runWithLockOverrideContext({ req: { user: { userId: 'admin-1' } }, overrideReason: null }, () =>
        guard.assertWritable(VENDOR_ID, ['2026-08-15']),
      ),
    );
    expect(err.getResponse()).toMatchObject({ code: 'PERIOD_CLOSED', canOverride: true, periods: ['2026-08'] });
    expect((err.getResponse() as { message: string }).message).toMatch(/reason \(min 10 characters\)/);
    expect(prisma.cashLedgerPeriod.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a reason shorter than 10 trimmed chars is rejected', async () => {
    const { guard } = build({ closed: ['2026-08'], canOverride: true });
    const err = await rejection(
      runWithLockOverrideContext({ req: { user: { userId: 'admin-1' } }, overrideReason: '   too short   ' }, () =>
        guard.assertWritable(VENDOR_ID, ['2026-08-15']),
      ),
    );
    expect(err.getResponse()).toMatchObject({ code: 'PERIOD_CLOSED', canOverride: true });
  });

  it('valid reason + permission -> passes, bumps overrideCount and writes a LOCK_OVERRIDE audit with the reason', async () => {
    const { guard, prisma, audit } = build({ closed: ['2026-08'], canOverride: true });
    await runWithLockOverrideContext({ req: { user: { userId: 'admin-1' } }, overrideReason: GOOD_REASON }, () =>
      guard.assertWritable(VENDOR_ID, ['2026-08-15']),
    );

    expect(prisma.cashLedgerPeriod.updateMany).toHaveBeenCalledTimes(1);
    const upd = prisma.cashLedgerPeriod.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ vendorId: VENDOR_ID, periodLabel: '2026-08' });
    expect(upd.data.overrideCount).toEqual({ increment: 1 });
    expect(upd.data.lastOverrideAt).toBeInstanceOf(Date);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      vendorId: VENDOR_ID,
      userId: 'admin-1',
      action: 'LOCK_OVERRIDE',
      entity: 'CashLedgerPeriod',
      entityId: 'id-2026-08',
      changes: { after: { periods: ['2026-08'], dates: ['2026-08-15'] }, reason: GOOD_REASON },
    });
  });

  it('an edit passing BOTH an open and a closed date is blocked (moving across the boundary)', async () => {
    const { guard } = build({ closed: ['2026-08'] });
    const err = await rejection(guard.assertWritable(VENDOR_ID, ['2026-09-02', new Date('2026-08-30T00:00:00Z')]));
    expect(err.getResponse()).toMatchObject({ code: 'PERIOD_CLOSED', periods: ['2026-08'] });
  });

  it('several closed periods: message names them all and each is counted / audited on override', async () => {
    const { guard, prisma, audit } = build({ closed: ['2026-07', '2026-08'], canOverride: true });
    const err = await rejection(guard.assertWritable(VENDOR_ID, ['2026-07-31', '2026-08-01']));
    expect(err.getResponse()).toMatchObject({ periods: ['2026-07', '2026-08'] });
    expect((err.getResponse() as { message: string }).message).toMatch(/Jul 2026.*Aug 2026/);

    await guard.assertWritable(VENDOR_ID, ['2026-07-31', '2026-08-01'], { userId: 'admin-1', overrideReason: GOOD_REASON });
    expect(prisma.cashLedgerPeriod.updateMany).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('opts.userId / opts.overrideReason beat the request context', async () => {
    const { guard, permissions } = build({ closed: ['2026-08'], canOverride: true });
    await runWithLockOverrideContext({ req: { user: { userId: 'ctx-user' } }, overrideReason: 'context reason, long enough' }, () =>
      guard.assertWritable(VENDOR_ID, ['2026-08-15'], { userId: 'opts-user', overrideReason: 'options reason, long enough' }),
    );
    expect(permissions.can).toHaveBeenCalledWith('opts-user', 'van_cash_ledger:override_lock');
    const audit = (guard as unknown as { audit: { log: jest.Mock } }).audit;
    expect(audit.log.mock.calls[0][0]).toMatchObject({ userId: 'opts-user', changes: { reason: 'options reason, long enough' } });
  });

  it('explicit opts work with no ALS context at all (service-to-service call carrying the acting user)', async () => {
    const { guard } = build({ closed: ['2026-08'], canOverride: true });
    await expect(
      guard.assertWritable(VENDOR_ID, ['2026-08-15'], { userId: 'admin-1', overrideReason: GOOD_REASON }),
    ).resolves.toBeUndefined();
  });

  it('a reason with no user (no context user, no opts.userId) never overrides', async () => {
    const { guard } = build({ closed: ['2026-08'], canOverride: true });
    const err = await rejection(guard.assertWritable(VENDOR_ID, ['2026-08-15'], { overrideReason: GOOD_REASON }));
    expect(err.getResponse()).toMatchObject({ code: 'PERIOD_CLOSED', canOverride: false });
  });

  it('PKT boundary: a date-only 1 Sep (UTC midnight) is September, an instant at 23:30 PKT on 31 Aug is August', async () => {
    const { guard } = build({ closed: ['2026-08'] });
    await expect(guard.assertWritable(VENDOR_ID, [new Date('2026-09-01T00:00:00.000Z')])).resolves.toBeUndefined();
    // 2026-08-31T18:30Z = 23:30 PKT on 31 Aug
    await expect(guard.assertWritable(VENDOR_ID, [new Date('2026-08-31T18:30:00.000Z')])).rejects.toBeInstanceOf(ForbiddenException);
  });
});
