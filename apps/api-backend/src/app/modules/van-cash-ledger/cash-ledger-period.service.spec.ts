import { BadRequestException, ConflictException } from '@nestjs/common';
import { CashLedgerPeriodStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { CashLedgerPeriodService } from './cash-ledger-period.service';
import { CashLedgerPeriodStore } from './cash-ledger-period.store';

const VENDOR_ID = 'vendor-001';
const NOW = new Date('2026-09-18T07:00:00.000Z'); // 12:00 PKT, 18 Sep 2026

const admin: AuthUser = {
  userId: 'admin-001',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'VENDOR_ADMIN',
  vendorId: VENDOR_ID,
  customerId: null,
};

const STATEMENT = { broughtForward: 1000, expectedClosing: 2500, net: 1500 };

type Row = {
  id: string;
  vendorId: string;
  periodLabel: string;
  status: CashLedgerPeriodStatus;
  closedAt: Date | null;
  closedById: string | null;
  closeNote: string | null;
  closingBalance: number | null;
  reopenedAt: Date | null;
  reopenedById: string | null;
  reopenReason: string | null;
  reopenCount: number;
  overrideCount: number;
  lastOverrideAt: Date | null;
};

function row(label: string, over: Partial<Row> = {}): Row {
  return {
    id: `id-${label}`,
    vendorId: VENDOR_ID,
    periodLabel: label,
    status: CashLedgerPeriodStatus.CLOSED,
    closedAt: new Date('2026-09-02T05:00:00.000Z'),
    closedById: 'admin-001',
    closeNote: null,
    closingBalance: 1000,
    reopenedAt: null,
    reopenedById: null,
    reopenReason: null,
    reopenCount: 0,
    overrideCount: 0,
    lastOverrideAt: null,
    ...over,
  };
}

interface Setup {
  rows?: Row[];
  /** Earliest activity date per source model (any subset). */
  mins?: Partial<Record<'handover' | 'manual' | 'expense' | 'advance' | 'settlement' | 'remittance' | 'fuelCard' | 'crewCash', Date>>;
  pendingHandovers?: { count: number; amount: number };
  pendingRemittances?: { count: number; amount: number };
  pendingAdvances?: { count: number; amount: number };
  openSheets?: number;
  statement?: Record<string, number>;
  live?: Record<string, number>; // lastDay -> live closing balance
  canClose?: boolean;
  canOverride?: boolean;
}

function build(s: Setup = {}) {
  const rows = s.rows ?? [];
  const minAgg = (key: keyof NonNullable<Setup['mins']>, field: string) => ({
    aggregate: jest.fn().mockImplementation(async (args: { _min?: unknown }) => {
      if (args._min) return { _min: { [field]: s.mins?.[key] ?? null } };
      return { _sum: { amount: 0 }, _count: { _all: 0 } };
    }),
  });
  const pendingAgg = (key: keyof NonNullable<Setup['mins']>, field: string, pending?: { count: number; amount: number }) => ({
    aggregate: jest.fn().mockImplementation(async (args: { _min?: unknown }) => {
      if (args._min) return { _min: { [field]: s.mins?.[key] ?? null } };
      return { _sum: { amount: pending?.amount ?? 0 }, _count: { _all: pending?.count ?? 0 } };
    }),
  });

  const prisma: any = {
    cashLedgerPeriod: {
      findMany: jest.fn().mockImplementation(async (args: { where: { status?: string } }) =>
        args.where.status === 'CLOSED' ? rows.filter((r) => r.status === 'CLOSED') : rows,
      ),
      findFirst: jest
        .fn()
        .mockImplementation(async (args: { where: { periodLabel?: string; id?: string } }) =>
          rows.find((r) => (args.where.periodLabel ? r.periodLabel === args.where.periodLabel : r.id === args.where.id)) ?? null,
        ),
      create: jest.fn().mockImplementation(async ({ data }: { data: Partial<Row> }) => ({ ...row(data.periodLabel as string), ...data, id: 'new-id' })),
      // Applies the update to the matching in-memory row (honours the status CAS + {increment}) so re-reads see it.
      updateMany: jest.fn().mockImplementation(async (args: { where: { id?: string; status?: string }; data: Record<string, any> }) => {
        const target = rows.find((r) => r.id === args.where.id && (!args.where.status || r.status === args.where.status));
        if (!target) return { count: 0 };
        for (const [k, v] of Object.entries(args.data)) {
          (target as any)[k] = v && typeof v === 'object' && 'increment' in v ? (target as any)[k] + v.increment : v;
        }
        return { count: 1 };
      }),
    },
    vanCashHandover: pendingAgg('handover', 'date', s.pendingHandovers),
    vanCashOpeningBalance: minAgg('manual', 'openingDate'),
    expense: minAgg('expense', 'date'),
    staffLedgerEntry: pendingAgg('advance', 'effectiveDate', s.pendingAdvances),
    settlement: minAgg('settlement', 'paidAt'),
    officeCashRemittance: pendingAgg('remittance', 'date', s.pendingRemittances),
    fuelCardTopUp: minAgg('fuelCard', 'date'),
    standaloneCrewCashExpense: minAgg('crewCash', 'date'),
    dailySheet: { count: jest.fn().mockResolvedValue(s.openSheets ?? 0) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-001', name: 'Admin' }, { id: 'admin-002', name: 'Second Admin' }]) },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const vanCashLedger = {
    getClosingBalanceAsOf: jest.fn().mockImplementation(async (_v: string, lastDay: string) => s.live?.[lastDay] ?? 0),
    getStatementForRange: jest.fn().mockResolvedValue({ ...STATEMENT, ...(s.statement ?? {}) }),
  };
  const permissions = {
    can: jest.fn().mockImplementation(async (_u: string, p: string) =>
      p === 'van_cash_ledger:close_period' ? (s.canClose ?? true) : (s.canOverride ?? true),
    ),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const store = new CashLedgerPeriodStore(prisma);
  const svc = new CashLedgerPeriodService(prisma, store, vanCashLedger as never, permissions as never, audit as never);
  return { svc, prisma, vanCashLedger, permissions, audit };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('CashLedgerPeriodService.list', () => {
  it('spans current month back to the earliest activity across ALL sources (min of the minimums)', async () => {
    const { svc } = build({
      mins: {
        handover: new Date('2026-08-01T00:00:00.000Z'),
        fuelCard: new Date('2026-06-15T00:00:00.000Z'), // the earliest
        crewCash: new Date('2026-07-20T00:00:00.000Z'),
      },
    });
    const res = await svc.list(admin);
    expect(res.currentLabel).toBe('2026-09');
    expect(res.periods.map((p) => p.label)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
  });

  it('no activity at all -> just the current month', async () => {
    const { svc, vanCashLedger } = build();
    const res = await svc.list(admin);
    expect(res.periods.map((p) => p.label)).toEqual(['2026-09']);
    expect(res.periods[0]).toMatchObject({ isCurrent: true, hasEnded: false, status: 'OPEN', drift: null, closingBalance: null, canReopen: false });
    expect(vanCashLedger.getClosingBalanceAsOf).toHaveBeenCalledTimes(1);
  });

  it('is capped at 24 periods', async () => {
    const { svc } = build({ mins: { handover: new Date('2020-01-05T00:00:00.000Z') } });
    const res = await svc.list(admin);
    expect(res.periods).toHaveLength(24);
    expect(res.periods[0].label).toBe('2026-09');
    expect(res.periods[23].label).toBe('2024-10');
  });

  it('drift = live - closed (2dp); OPEN periods have null drift/closingBalance; canReopen only for the latest closed', async () => {
    const { svc } = build({
      mins: { handover: new Date('2026-07-10T00:00:00.000Z') },
      rows: [
        row('2026-07', { closingBalance: 1000, closedById: 'admin-001' }),
        row('2026-08', { closingBalance: 2000, closedById: 'admin-002', closeNote: 'August done', overrideCount: 2, lastOverrideAt: new Date('2026-09-10T00:00:00.000Z') }),
      ],
      live: { '2026-07-31': 1050.005, '2026-08-31': 2000, '2026-09-30': 2500 },
    });
    const res = await svc.list(admin);
    const [sep, aug, jul] = res.periods;

    expect(sep).toMatchObject({ label: '2026-09', status: 'OPEN', isCurrent: true, closingBalance: null, drift: null, liveClosingBalance: 2500, canReopen: false });
    expect(aug).toMatchObject({
      label: '2026-08',
      displayLabel: 'Aug 2026',
      firstDay: '2026-08-01',
      lastDay: '2026-08-31',
      status: 'CLOSED',
      hasEnded: true,
      closedByName: 'Second Admin',
      closeNote: 'August done',
      overrideCount: 2,
      closingBalance: 2000,
      liveClosingBalance: 2000,
      drift: 0,
      canReopen: true,
    });
    expect(jul).toMatchObject({ status: 'CLOSED', closedByName: 'Admin', closingBalance: 1000, liveClosingBalance: 1050.01, drift: 50.01, canReopen: false });
  });

  it('a reopened (OPEN) row keeps its history but is OPEN with no closingBalance / drift', async () => {
    const { svc } = build({
      mins: { handover: new Date('2026-08-10T00:00:00.000Z') },
      rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN, reopenCount: 1, reopenedById: 'admin-002', reopenReason: 'late invoice', reopenedAt: new Date('2026-09-05T00:00:00.000Z') })],
    });
    const aug = (await svc.list(admin)).periods.find((p) => p.label === '2026-08');
    expect(aug).toMatchObject({ status: 'OPEN', closingBalance: null, drift: null, reopenCount: 1, reopenReason: 'late invoice', reopenedByName: 'Second Admin', canReopen: false });
  });

  it('live balance is computed for every CLOSED period + only the newest 2 OPEN ones', async () => {
    const { svc, vanCashLedger } = build({
      mins: { handover: new Date('2026-01-05T00:00:00.000Z') }, // Jan..Sep = 9 periods
      rows: [row('2026-01')],
    });
    await svc.list(admin);
    const days = vanCashLedger.getClosingBalanceAsOf.mock.calls.map((c) => c[1]).sort();
    expect(days).toEqual(['2026-01-31', '2026-08-31', '2026-09-30']);
  });

  it('returns the caller permissions', async () => {
    const { svc, permissions } = build({ canClose: false, canOverride: true });
    const res = await svc.list(admin);
    expect(res.permissions).toEqual({ canClose: false, canOverride: true });
    expect(permissions.can).toHaveBeenCalledWith('admin-001', 'van_cash_ledger:close_period');
    expect(permissions.can).toHaveBeenCalledWith('admin-001', 'van_cash_ledger:override_lock');
  });

  it('is vendor scoped', async () => {
    const { svc, prisma } = build();
    await svc.list(admin);
    expect(prisma.cashLedgerPeriod.findMany).toHaveBeenCalledWith({ where: { vendorId: VENDOR_ID } });
  });
});

describe('CashLedgerPeriodService.closeCheck', () => {
  const codes = (items: Array<{ code: string }>) => items.map((i) => i.code);

  it('rejects a malformed label', async () => {
    const { svc } = build();
    await expect(svc.closeCheck(VENDOR_ID, '2026-9')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clean, ended, first period with activity -> closable, statement passed through', async () => {
    const { svc, vanCashLedger } = build({ mins: { handover: new Date('2026-08-05T00:00:00.000Z') } });
    const res = await svc.closeCheck(VENDOR_ID, '2026-08');
    expect(res).toMatchObject({ label: '2026-08', displayLabel: 'Aug 2026', firstDay: '2026-08-01', lastDay: '2026-08-31', status: 'OPEN', canClose: true, blockers: [], warnings: [] });
    expect(res.statement.expectedClosing).toBe(2500);
    expect(vanCashLedger.getStatementForRange).toHaveBeenCalledWith(VENDOR_ID, '2026-08-01', '2026-08-31');
  });

  it('no earlier activity at all -> the first ever period is closable (nothing to be "previous")', async () => {
    const { svc } = build(); // no activity anywhere
    const res = await svc.closeCheck(VENDOR_ID, '2026-08');
    expect(res.canClose).toBe(true);
    expect(codes(res.blockers)).toEqual([]);
  });

  it('PERIOD_NOT_ENDED for the current month', async () => {
    const { svc } = build({ mins: { handover: new Date('2026-09-01T00:00:00.000Z') } });
    const res = await svc.closeCheck(VENDOR_ID, '2026-09');
    expect(res.canClose).toBe(false);
    expect(codes(res.blockers)).toEqual(['PERIOD_NOT_ENDED']);
  });

  it('ALREADY_CLOSED', async () => {
    const { svc } = build({ mins: { handover: new Date('2026-08-05T00:00:00.000Z') }, rows: [row('2026-08')] });
    const res = await svc.closeCheck(VENDOR_ID, '2026-08');
    expect(res.status).toBe('CLOSED');
    expect(res.canClose).toBe(false);
    expect(codes(res.blockers)).toEqual(['ALREADY_CLOSED']);
  });

  it('PREVIOUS_PERIOD_OPEN names the EARLIEST open month at/after the first activity', async () => {
    jest.setSystemTime(new Date('2026-10-05T07:00:00.000Z'));
    const { svc } = build({
      mins: { handover: new Date('2026-06-12T00:00:00.000Z') },
      rows: [row('2026-06'), row('2026-08')], // July is open (a gap) and so is nothing else before Sep
    });
    const res = await svc.closeCheck(VENDOR_ID, '2026-09');
    const b = res.blockers.find((x) => x.code === 'PREVIOUS_PERIOD_OPEN');
    expect(b).toBeDefined();
    expect(b?.message).toContain('Jul 2026');
    expect(b?.count).toBe(1);
    expect(res.canClose).toBe(false);
  });

  it('sequential rule is satisfied when every month from the first activity is closed', async () => {
    jest.setSystemTime(new Date('2026-10-05T07:00:00.000Z'));
    const { svc } = build({
      mins: { handover: new Date('2026-07-12T00:00:00.000Z') },
      rows: [row('2026-07'), row('2026-08')],
    });
    const res = await svc.closeCheck(VENDOR_ID, '2026-09');
    expect(codes(res.blockers)).toEqual([]);
    expect(res.canClose).toBe(true);
  });

  it('a month BEFORE the first activity does not need closing', async () => {
    jest.setSystemTime(new Date('2026-10-05T07:00:00.000Z'));
    const { svc } = build({ mins: { handover: new Date('2026-09-02T00:00:00.000Z') } });
    expect((await svc.closeCheck(VENDOR_ID, '2026-09')).canClose).toBe(true);
  });

  it('PENDING_HANDOVERS and PENDING_REMITTANCES block, with count + amount', async () => {
    const { svc } = build({
      mins: { handover: new Date('2026-08-05T00:00:00.000Z') },
      pendingHandovers: { count: 3, amount: 4500.5 },
      pendingRemittances: { count: 1, amount: 20000 },
    });
    const res = await svc.closeCheck(VENDOR_ID, '2026-08');
    expect(res.canClose).toBe(false);
    expect(res.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PENDING_HANDOVERS', count: 3, amount: 4500.5 }),
        expect.objectContaining({ code: 'PENDING_REMITTANCES', count: 1, amount: 20000 }),
      ]),
    );
  });

  it('pending lookups are vendor + period scoped (PKT bounds)', async () => {
    const { svc, prisma } = build({ mins: { handover: new Date('2026-08-05T00:00:00.000Z') } });
    await svc.closeCheck(VENDOR_ID, '2026-08');
    const pendingCall = prisma.vanCashHandover.aggregate.mock.calls.find((c: any[]) => !c[0]._min)[0];
    expect(pendingCall.where.vendorId).toBe(VENDOR_ID);
    expect(pendingCall.where.status).toBe('PENDING');
    expect(pendingCall.where.date.gte.toISOString()).toBe('2026-07-31T19:00:00.000Z');
    expect(pendingCall.where.date.lte.toISOString()).toBe('2026-08-31T18:59:59.999Z');
    expect(prisma.dailySheet.count).toHaveBeenCalledWith({
      where: { vendorId: VENDOR_ID, isClosed: false, date: pendingCall.where.date },
    });
  });

  it('warnings: OPEN_SHEETS, PENDING_ADVANCES (absolute amount), NEGATIVE_BALANCE, REOPENED_BEFORE — none block', async () => {
    const { svc } = build({
      mins: { handover: new Date('2026-08-05T00:00:00.000Z') },
      openSheets: 2,
      pendingAdvances: { count: 2, amount: -7000 },
      statement: { expectedClosing: -120.5 },
      rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN, reopenCount: 2 })],
    });
    const res = await svc.closeCheck(VENDOR_ID, '2026-08');
    expect(res.canClose).toBe(true);
    expect(res.blockers).toEqual([]);
    expect(res.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OPEN_SHEETS', count: 2 }),
        expect.objectContaining({ code: 'PENDING_ADVANCES', count: 2, amount: 7000 }),
        expect.objectContaining({ code: 'NEGATIVE_BALANCE', amount: -120.5 }),
        expect.objectContaining({ code: 'REOPENED_BEFORE', count: 2 }),
      ]),
    );
    expect(res.warnings).toHaveLength(4);
  });

  it('a non-negative closing balance raises no NEGATIVE_BALANCE warning', async () => {
    const { svc } = build({ mins: { handover: new Date('2026-08-05T00:00:00.000Z') }, statement: { expectedClosing: 0 } });
    expect(codes((await svc.closeCheck(VENDOR_ID, '2026-08')).warnings)).toEqual([]);
  });
});

describe('CashLedgerPeriodService.close', () => {
  const clean: Setup = {
    mins: { handover: new Date('2026-08-05T00:00:00.000Z') },
    live: { '2026-08-31': 2500.004 },
  };

  it('blockers -> 400 PERIOD_CLOSE_BLOCKED with the blockers and nothing written', async () => {
    const { svc, prisma, audit } = build({ ...clean, pendingHandovers: { count: 1, amount: 10 } });
    const err = await svc.close(admin, '2026-08', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ statusCode: 400, code: 'PERIOD_CLOSE_BLOCKED', blockers: [expect.objectContaining({ code: 'PENDING_HANDOVERS' })] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('warnings without acknowledgement -> 400 WARNINGS_UNACKNOWLEDGED; acknowledged -> closes', async () => {
    const setup: Setup = { ...clean, openSheets: 1 };
    const a = build(setup);
    const err = await a.svc.close(admin, '2026-08', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'WARNINGS_UNACKNOWLEDGED', warnings: [expect.objectContaining({ code: 'OPEN_SHEETS' })] });
    expect(a.prisma.$transaction).not.toHaveBeenCalled();

    const b = build(setup);
    const info = await b.svc.close(admin, '2026-08', { acknowledgeWarnings: true });
    expect(info.status).toBe('CLOSED');
  });

  it('REOPENED_BEFORE alone (informational) does not need acknowledgement', async () => {
    const { svc } = build({ ...clean, rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN, reopenCount: 1 })] });
    await expect(svc.close(admin, '2026-08', {})).resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('success (no existing row): creates the CLOSED row with snapshot + closing balance, audits, returns the info', async () => {
    const { svc, prisma, audit, vanCashLedger } = build(clean);
    const info = await svc.close(admin, '2026-08', { note: '  August books closed  ' });

    expect(vanCashLedger.getClosingBalanceAsOf).toHaveBeenCalledWith(VENDOR_ID, '2026-08-31');
    expect(prisma.cashLedgerPeriod.create).toHaveBeenCalledTimes(1);
    const data = prisma.cashLedgerPeriod.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      vendorId: VENDOR_ID,
      periodLabel: '2026-08',
      status: 'CLOSED',
      closedById: 'admin-001',
      closeNote: 'August books closed',
      closingBalance: 2500,
    });
    expect(data.startDate.toISOString()).toBe('2026-07-31T19:00:00.000Z');
    expect(data.endDate.toISOString()).toBe('2026-08-31T18:59:59.999Z');
    expect(data.closedAt).toBeInstanceOf(Date);
    expect(data.snapshotJson).toMatchObject({ closingBalance: 2500, statement: expect.objectContaining({ expectedClosing: 2500 }) });
    expect(typeof data.snapshotJson.closedAt).toBe('string');

    expect(audit.log).toHaveBeenCalledWith({
      vendorId: VENDOR_ID,
      userId: 'admin-001',
      action: 'PERIOD_CLOSED',
      entity: 'CashLedgerPeriod',
      entityId: 'new-id',
      changes: { after: { label: '2026-08', closingBalance: 2500 }, reason: 'August books closed' },
    });
    expect(info).toMatchObject({ label: '2026-08', status: 'CLOSED', closingBalance: 2500, liveClosingBalance: 2500, drift: 0, canReopen: true, closeNote: 'August books closed' });
  });

  it('an existing OPEN (reopened) row is closed with a CAS updateMany where status = OPEN', async () => {
    const { svc, prisma } = build({ ...clean, rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN, reopenCount: 1 })] });
    await svc.close(admin, '2026-08', {});
    expect(prisma.cashLedgerPeriod.create).not.toHaveBeenCalled();
    const call = prisma.cashLedgerPeriod.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'id-2026-08', vendorId: VENDOR_ID, status: 'OPEN' });
    expect(call.data).toMatchObject({ status: 'CLOSED', closedById: 'admin-001', closingBalance: 2500 });
  });

  it('losing the CAS (someone closed it in between) -> 409', async () => {
    const { svc, prisma, audit } = build({ ...clean, rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN })] });
    prisma.cashLedgerPeriod.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.close(admin, '2026-08', {})).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a concurrent first-close hitting the unique index (P2002) -> 409', async () => {
    const { svc, prisma } = build(clean);
    prisma.cashLedgerPeriod.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc.close(admin, '2026-08', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('already closed -> 409 before anything else', async () => {
    const { svc, prisma } = build({ ...clean, rows: [row('2026-08')] });
    const err = await svc.close(admin, '2026-08', { acknowledgeWarnings: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ statusCode: 409, code: 'PERIOD_ALREADY_CLOSED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('CashLedgerPeriodService.reopen', () => {
  const reason = 'Late supplier invoice found';

  it('reason must be >= 10 trimmed chars', async () => {
    const { svc, prisma } = build({ rows: [row('2026-08')] });
    await expect(svc.reopen(admin, '2026-08', { reason: '   short   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only a CLOSED period can be reopened', async () => {
    const { svc } = build({ rows: [row('2026-08', { status: CashLedgerPeriodStatus.OPEN })] });
    await expect(svc.reopen(admin, '2026-08', { reason })).rejects.toBeInstanceOf(BadRequestException);
    const none = build();
    await expect(none.svc.reopen(admin, '2026-08', { reason })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only the MOST RECENT closed period can be reopened — the error names the later one', async () => {
    const { svc, prisma } = build({ rows: [row('2026-07'), row('2026-08')] });
    const err = await svc.reopen(admin, '2026-07', { reason }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/Only the most recent closed period can be reopened/);
    expect(err.message).toContain('Aug 2026');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('success: flips to OPEN with who/when/why + reopenCount increment, audits with the reason', async () => {
    const { svc, prisma, audit } = build({
      rows: [row('2026-07'), row('2026-08', { closingBalance: 2000, reopenCount: 1 })],
      live: { '2026-08-31': 2100 },
    });
    const info = await svc.reopen(admin, '2026-08', { reason: `  ${reason}  ` });

    const upd = prisma.cashLedgerPeriod.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'id-2026-08', vendorId: VENDOR_ID, status: 'CLOSED' });
    expect(upd.data).toMatchObject({ status: 'OPEN', reopenedById: 'admin-001', reopenReason: reason, reopenCount: { increment: 1 } });
    expect(upd.data.reopenedAt).toBeInstanceOf(Date);

    expect(audit.log).toHaveBeenCalledWith({
      vendorId: VENDOR_ID,
      userId: 'admin-001',
      action: 'PERIOD_REOPENED',
      entity: 'CashLedgerPeriod',
      entityId: 'id-2026-08',
      changes: { before: { status: 'CLOSED', closingBalance: 2000 }, after: { status: 'OPEN', reopenCount: 2 }, reason },
    });
    expect(info).toMatchObject({ status: 'OPEN', reopenCount: 2, reopenReason: reason, closingBalance: null, drift: null, liveClosingBalance: 2100, canReopen: false });
  });

  it('losing the CAS -> 409', async () => {
    const { svc, prisma, audit } = build({ rows: [row('2026-08')] });
    prisma.cashLedgerPeriod.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.reopen(admin, '2026-08', { reason })).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects a malformed label', async () => {
    const { svc } = build();
    await expect(svc.reopen(admin, 'August', { reason })).rejects.toBeInstanceOf(BadRequestException);
  });
});
