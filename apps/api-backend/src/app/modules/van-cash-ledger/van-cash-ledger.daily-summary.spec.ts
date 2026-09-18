import {
  ExpenseCategory,
  FuelCardTopUpStatus,
  LedgerEntryStatus,
  ManualCashInStatus,
  OfficeCashRemittanceDestination,
  OfficeCashRemittanceStatus,
  SettlementMethod,
  StaffLedgerCategory,
  StandaloneCrewCashStatus,
  VanCashHandoverStatus,
} from '@prisma/client';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { CashLedgerDailySummaryQueryDto } from './dto/cash-ledger-daily-summary-query.dto';

/**
 * GET daily-summary (Cash Ledger P3) — service-level tests against the same
 * kind of in-memory Prisma double as van-cash-ledger.reads.spec.ts (copied, not
 * shared, so the reads spec stays untouched). The double really EVALUATES the
 * `where` clauses (equality, `in`, `lt/lte/gte`, null), so the PKT window, van
 * scoping and pending-memo filters are exercised for real.
 */

const VENDOR_ID = 'vendor-001';
const VAN_ID = 'van-001';
const OTHER_VAN_ID = 'van-002';

// ─── in-memory prisma double (copy of the reads spec's) ─────────────────────

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return +value === +cond;
    if (typeof cond === 'object') {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(value < cond.lt)) return false;
      if ('lte' in cond && !(value <= cond.lte)) return false;
      if ('gte' in cond && !(value >= cond.gte)) return false;
      return true;
    }
    return value === cond;
  });
}

function model(rows: any[]) {
  return {
    findMany: jest.fn().mockImplementation(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    aggregate: jest.fn().mockImplementation(async ({ where, _sum }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      const sums: Record<string, number | null> = {};
      for (const key of Object.keys(_sum ?? {})) {
        sums[key] = hit.length ? hit.reduce((acc, r) => acc + (r[key] as number), 0) : null;
      }
      return { _sum: sums, _count: { _all: hit.length } };
    }),
    groupBy: jest.fn().mockImplementation(async ({ by, where, _sum }: any) => {
      const groups = new Map<string, any[]>();
      for (const r of rows.filter((row) => matches(row, where))) {
        const key = by.map((k: string) => r[k]).join('|');
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((hit) => ({
        ...Object.fromEntries(by.map((k: string) => [k, hit[0][k]])),
        _sum: Object.fromEntries(Object.keys(_sum ?? {}).map((k) => [k, hit.reduce((acc, r) => acc + (r[k] as number), 0)])),
      }));
    }),
    findFirst: jest.fn().mockImplementation(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    count: jest.fn().mockImplementation(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
  };
}

interface Data {
  handovers?: any[];
  manual?: any[];
  expenses?: any[];
  ledger?: any[];
  settlements?: any[];
  remittances?: any[];
  fuel?: any[];
  crew?: any[];
}

function makeService(data: Data = {}) {
  const prisma: any = {
    vanCashHandover: model(data.handovers ?? []),
    vanCashOpeningBalance: model(data.manual ?? []),
    expense: model(data.expenses ?? []),
    staffLedgerEntry: model(data.ledger ?? []),
    settlement: model(data.settlements ?? []),
    officeCashRemittance: model(data.remittances ?? []),
    fuelCardTopUp: model(data.fuel ?? []),
    standaloneCrewCashExpense: model(data.crew ?? []),
    dailySheet: model([]),
    crewCashDistribution: model([]),
    auditLog: model([]),
    van: model([]),
    user: model([]),
    staffLedgerAuditLog: model([]),
  };
  const permissions = { can: jest.fn().mockResolvedValue(false) };
  const periodGuard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const svc = new VanCashLedgerService(prisma, { log: jest.fn() } as any, permissions as any, periodGuard as any, { getClosedLabels: jest.fn().mockResolvedValue(new Set()), closedLabelsAmong: jest.fn().mockResolvedValue([]), isDateClosed: jest.fn().mockResolvedValue(false) } as any);
  return { svc, prisma };
}

// ─── row builders ───────────────────────────────────────────────────────────

const iso = (s: string) => new Date(s);

function handover(id: string, date: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: VENDOR_ID,
    vanId: VAN_ID,
    dailySheetId: `sheet-${id}`,
    amount,
    expectedAmount: amount,
    submittedById: 'driver',
    date: iso(date),
    status: VanCashHandoverStatus.APPROVED,
    correctsEntryId: null,
    version: 1,
    createdAt: iso(date),
    van: { plateNumber: 'ABC-123' },
    submittedBy: { name: 'Driver' },
    approvedBy: { name: 'Admin' },
    ...over,
  };
}

function manual(id: string, openingDate: string, openingBalance: number, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: VENDOR_ID,
    vanId: null,
    openingBalance,
    openingDate: iso(openingDate),
    note: null,
    source: null,
    status: ManualCashInStatus.ACTIVE,
    version: 1,
    editCount: 0,
    lastEditedAt: null,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: iso(openingDate),
    van: null,
    ...over,
  };
}

function expense(id: string, date: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: VENDOR_ID,
    category: ExpenseCategory.OTHER,
    amount,
    paidFromCash: true,
    description: `Expense ${id}`,
    date: iso(date),
    createdAt: iso(date),
    dailySheetId: null,
    vanId: null,
    fuelLog: null,
    vehicleServiceRecord: null,
    van: null,
    createdBy: { name: 'Accountant' },
    dailySheet: null,
    ...over,
  };
}

function ledgerEntry(id: string, category: StaffLedgerCategory, status: LedgerEntryStatus, amount: number, date: string) {
  return {
    id,
    vendorId: VENDOR_ID,
    category,
    status,
    amount,
    description: `${category} ${id}`,
    effectiveDate: iso(date),
    createdAt: iso(date),
    user: { name: 'Bilal' },
    createdBy: { name: 'Accountant' },
    payrollEntryId: null,
  };
}

function settlement(id: string, method: SettlementMethod, amount: number, paidAt: string) {
  return {
    id,
    vendorId: VENDOR_ID,
    method,
    amount,
    paidAt: iso(paidAt),
    createdAt: iso(paidAt),
    payrollEntry: { user: { name: 'Bilal' } },
    paidBy: { name: 'Accountant' },
  };
}

function remittance(
  id: string,
  date: string,
  amount: number,
  status: OfficeCashRemittanceStatus = OfficeCashRemittanceStatus.APPROVED,
) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: iso(date),
    createdAt: iso(date),
    destination: OfficeCashRemittanceDestination.OWNER,
    destinationName: null,
    reference: null,
    status,
    correctsEntryId: null,
    version: 1,
    voidReason: null,
    submittedBy: { name: 'Accountant' },
    approvedBy: { name: 'Admin' },
    voidedBy: null,
  };
}

function fuelTopUp(id: string, date: string, amount: number) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: iso(date),
    createdAt: iso(date),
    reference: null,
    status: FuelCardTopUpStatus.ACTIVE,
    voidReason: null,
    fuelCard: { name: 'PSO Card' },
    createdBy: { name: 'Accountant' },
    voidedBy: null,
  };
}

function crewCash(id: string, date: string, amount: number, status: StandaloneCrewCashStatus = StandaloneCrewCashStatus.ACTIVE) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: iso(date),
    createdAt: iso(date),
    category: 'MEAL',
    status,
    voidReason: null,
    employee: { name: 'Loader' },
    createdBy: { name: 'Accountant' },
  };
}

// ─── fixture: multi-day, multi-week, multi-month, every cash tier ───────────

const FIGURES = [
  'sheetCashIn',
  'officeCashIn',
  'totalCashIn',
  'officeExpenses',
  'payrollCash',
  'crewCash',
  'totalExpenses',
  'ownerTransfer',
  'fuelCard',
  'net',
] as const;

const multiData: Data = {
  // Before the window -> brought forward = 10000 + 5000 - 2000 = 13000.
  manual: [manual('m-old', '2026-08-01T06:00:00Z', 10000), manual('m-in', '2026-09-30T06:00:00Z', 900)],
  handovers: [
    handover('h-old', '2026-08-05T06:00:00Z', 5000),
    handover('h1', '2026-09-02T06:00:00Z', 3000),
    handover('h2', '2026-09-07T06:00:00Z', 2500), // Monday
    handover('h3', '2026-10-01T06:00:00Z', 1200),
    handover('h-other-van', '2026-09-08T06:00:00Z', 400, { vanId: OTHER_VAN_ID }),
  ],
  expenses: [
    expense('e-old', '2026-08-10T06:00:00Z', 2000),
    expense('e1', '2026-09-03T06:00:00Z', 500),
    expense('e2', '2026-09-27T06:00:00Z', 50, { vanId: VAN_ID }), // Sunday
  ],
  remittances: [remittance('r1', '2026-09-04T06:00:00Z', 1000)],
  fuel: [fuelTopUp('f1', '2026-09-04T07:00:00Z', 200)],
  crew: [crewCash('c1', '2026-09-08T08:00:00Z', 100)],
  ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -700, '2026-09-15T09:00:00Z')],
  settlements: [settlement('s1', SettlementMethod.CASH, 1300, '2026-09-15T10:00:00Z')],
};

const RANGE = { from: '2026-09-01', to: '2026-10-05' };

describe('VanCashLedgerService.getDailySummary (Cash Ledger P3)', () => {
  describe('I1: table reconciles with GET /summary', () => {
    for (const group of ['day', 'week', 'month'] as const) {
      for (const includeEmpty of [false, true]) {
        it(`group=${group} includeEmpty=${includeEmpty}: sums == statement; totals == statement; chain; newest closing == expectedClosing`, async () => {
          const { svc } = makeService(multiData);

          const summary = await svc.getSummary(VENDOR_ID, RANGE);
          const table = await svc.getDailySummary(VENDOR_ID, { ...RANGE, group, includeEmpty });

          expect(table.group).toBe(group);
          expect(table.scope).toBe('OFFICE');
          expect(table.range).toEqual({ from: '2026-09-01', to: '2026-10-05' });
          expect(table.truncated).toBe(false);

          // Σ of the rows == the statement, figure by figure.
          for (const key of FIGURES) {
            expect(Math.round(table.rows.reduce((s, r) => s + r[key], 0) * 100) / 100).toBe(summary.statement[key]);
            expect(table.totals[key]).toBe(summary.statement[key]);
          }
          expect(table.totals.broughtForward).toBe(13000);
          expect(table.totals.broughtForward).toBe(summary.statement.broughtForward);
          expect(table.totals.expectedClosing).toBe(summary.statement.expectedClosing);

          // Chain: each row closes where the next-older row opens; oldest opens at brought-forward.
          for (let i = 0; i < table.rows.length - 1; i++) {
            expect(table.rows[i].opening).toBe(table.rows[i + 1].closing);
          }
          expect(table.rows[table.rows.length - 1].opening).toBe(summary.statement.broughtForward);
          expect(table.rows[0].closing).toBe(table.totals.expectedClosing);
          for (const r of table.rows) expect(Math.round((r.opening + r.net) * 100) / 100).toBe(r.closing);
        });
      }
    }

    it('sanity: the fixture folds to a known closing (13000 + 3000+2500+1200+900 - 500-50-2000-1300... via the ledger)', async () => {
      const { svc } = makeService(multiData);
      const summary = await svc.getSummary(VENDOR_ID, RANGE);
      // cash in: 3000+2500+1200 (+400 other van) + 900 manual; out: 500+50 expenses, 700+1300 payroll, 100 crew, 1000 owner, 200 fuel
      expect(summary.statement.totalCashIn).toBe(3000 + 2500 + 1200 + 400 + 900);
      expect(summary.statement.expectedClosing).toBe(13000 + 8000 - (550 + 2000 + 100) - 1000 - 200);
    });

    it('entryCount / lateCount totals match the timeline', async () => {
      const { svc } = makeService(multiData);
      const table = await svc.getDailySummary(VENDOR_ID, RANGE);
      const timeline = await svc.getTimeline(VENDOR_ID, { ...RANGE, limit: 100 });
      expect(table.totals.entryCount).toBe(timeline.meta.total);
      expect(table.totals.lateCount).toBe(timeline.data.filter((r) => r.lagDays > 0).length);
      expect(table.rows.reduce((s, r) => s + r.entryCount, 0)).toBe(timeline.meta.total);
    });

    it('van scope: rows / totals equal getSummary({ vanId }) and the vendor-wide tiers are absent', async () => {
      const { svc, prisma } = makeService(multiData);
      const query = { ...RANGE, vanId: VAN_ID };

      const summary = await svc.getSummary(VENDOR_ID, query);
      const table = await svc.getDailySummary(VENDOR_ID, { ...query, group: 'week' });

      expect(table.scope).toBe('VAN');
      for (const key of FIGURES) {
        expect(table.totals[key]).toBe(summary.statement[key]);
        expect(Math.round(table.rows.reduce((s, r) => s + r[key], 0) * 100) / 100).toBe(summary.statement[key]);
      }
      expect(table.totals.broughtForward).toBe(summary.statement.broughtForward);
      expect(table.totals.expectedClosing).toBe(summary.statement.expectedClosing);
      expect(table.totals).toMatchObject({ ownerTransfer: 0, fuelCard: 0, crewCash: 0, payrollCash: 0 });
      expect(table.rows[0].closing).toBe(summary.statement.expectedClosing);
      // The other van's handover is not in the van's table.
      expect(table.totals.sheetCashIn).toBe(3000 + 2500 + 1200);
      expect(prisma.officeCashRemittance.findMany).not.toHaveBeenCalled();
    });
  });

  describe('grouping through the service', () => {
    it('week grouping across a Monday boundary and a month boundary (28 Sep - 4 Oct week)', async () => {
      const { svc } = makeService(multiData);
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-30', to: '2026-10-01', group: 'week' });

      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]).toMatchObject({
        key: '2026-09-28',
        label: '30 Sep – 1 Oct 2026',
        from: '2026-09-30',
        to: '2026-10-01',
        sheetCashIn: 1200,
        officeCashIn: 900,
        entryCount: 2,
      });
    });

    it('weeks split on Monday 7 Sep; a range clamps the first/last weeks', async () => {
      const { svc } = makeService(multiData);
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-02', to: '2026-09-13', group: 'week' });
      expect(table.rows.map((r) => [r.key, r.from, r.to, r.label])).toEqual([
        ['2026-09-07', '2026-09-07', '2026-09-13', '7 – 13 Sep 2026'],
        ['2026-08-31', '2026-09-02', '2026-09-06', '2 – 6 Sep 2026'],
      ]);
    });

    it('month grouping: Sep and Oct rows with clamped bounds', async () => {
      const { svc } = makeService(multiData);
      const table = await svc.getDailySummary(VENDOR_ID, { ...RANGE, group: 'month' });
      expect(table.rows.map((r) => [r.key, r.label, r.from, r.to])).toEqual([
        ['2026-10', 'Oct 2026', '2026-10-01', '2026-10-05'],
        ['2026-09', 'Sep 2026', '2026-09-01', '2026-09-30'],
      ]);
      expect(table.rows[0]).toMatchObject({ sheetCashIn: 1200, entryCount: 1 });
    });

    it('PKT day boundary: 23:30 PKT vs 00:30 PKT entries land in different days', async () => {
      const { svc } = makeService({
        expenses: [
          expense('late-night', '2026-09-10T18:30:00Z', 100), // 23:30 PKT on the 10th
          expense('after-midnight', '2026-09-10T19:30:00Z', 40), // 00:30 PKT on the 11th
        ],
      });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-10', to: '2026-09-11' });
      expect(table.rows.map((r) => [r.key, r.officeExpenses])).toEqual([
        ['2026-09-11', 40],
        ['2026-09-10', 100],
      ]);
    });

    it('a full-ISO from/to is bucketed into its PKT day (range echo + window)', async () => {
      const { svc } = makeService({ expenses: [expense('e', '2026-09-10T06:00:00Z', 10)] });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-09T19:30:00Z', to: '2026-09-10T18:30:00Z' });
      expect(table.range).toEqual({ from: '2026-09-10', to: '2026-09-10' });
      expect(table.rows.map((r) => r.key)).toEqual(['2026-09-10']);
    });
  });

  describe('includeEmpty', () => {
    it('fills every PKT day in [from, to]; balance carries across empty days', async () => {
      const { svc } = makeService({
        manual: [manual('m', '2026-08-01T06:00:00Z', 1000)],
        expenses: [expense('e', '2026-09-03T06:00:00Z', 250)],
      });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-01', to: '2026-09-05', includeEmpty: true });

      expect(table.rows.map((r) => r.key)).toEqual(['2026-09-05', '2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01']);
      expect(table.rows.map((r) => r.isEmpty)).toEqual([true, true, false, true, true]);
      expect(table.rows.map((r) => [r.opening, r.closing])).toEqual([
        [750, 750],
        [750, 750],
        [1000, 750],
        [1000, 1000],
        [1000, 1000],
      ]);
      expect(table.totals.expectedClosing).toBe(750);
    });

    it('without includeEmpty only days with activity appear', async () => {
      const { svc } = makeService({ expenses: [expense('e', '2026-09-03T06:00:00Z', 250)] });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-01', to: '2026-09-05', includeEmpty: false });
      expect(table.rows.map((r) => r.key)).toEqual(['2026-09-03']);
    });
  });

  describe('counts', () => {
    it('recordedCount vs entryCount for a backdated entry', async () => {
      const { svc } = makeService({
        // Dated the 10th, recorded on the 12th.
        expenses: [expense('backdated', '2026-09-10T06:00:00Z', 100, { createdAt: iso('2026-09-12T06:00:00Z') })],
      });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-10', to: '2026-09-12', includeEmpty: true });
      const byKey = Object.fromEntries(table.rows.map((r) => [r.key, r]));
      expect(byKey['2026-09-10']).toMatchObject({ entryCount: 1, recordedCount: 0, lateCount: 1 });
      expect(byKey['2026-09-11']).toMatchObject({ entryCount: 0, recordedCount: 0, lateCount: 0 });
      expect(byKey['2026-09-12']).toMatchObject({ entryCount: 0, recordedCount: 1, lateCount: 0, isEmpty: true });
      expect(table.totals).toMatchObject({ entryCount: 1, lateCount: 1 });
    });

    it('editedCount (plain expense edited > 60s after creation) and voidedCount (voided rows count as entries, fold 0)', async () => {
      const { svc } = makeService({
        expenses: [
          expense('edited', '2026-09-10T06:00:00Z', 100, { updatedAt: iso('2026-09-10T08:00:00Z') }),
          expense('untouched', '2026-09-10T06:00:00Z', 20, { updatedAt: iso('2026-09-10T06:00:10Z') }),
        ],
        crew: [crewCash('voided', '2026-09-10T07:00:00Z', 999, StandaloneCrewCashStatus.VOIDED)],
      });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-10', to: '2026-09-10' });
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]).toMatchObject({
        entryCount: 3,
        editedCount: 1,
        voidedCount: 1,
        officeExpenses: 120,
        crewCash: 0,
        net: -120,
      });
    });
  });

  describe('pending memo', () => {
    const t = '2026-09-10T06:00:00Z';
    const pendingData: Data = {
      handovers: [
        handover('h-ok', t, 1000),
        handover('p1', t, 100, { status: VanCashHandoverStatus.PENDING }),
        handover('p2', '2026-09-11T06:00:00Z', 250, { status: VanCashHandoverStatus.PENDING }),
        handover('p-other', t, 999, { status: VanCashHandoverStatus.PENDING, vanId: OTHER_VAN_ID }),
        handover('p-outside', '2026-10-20T06:00:00Z', 5, { status: VanCashHandoverStatus.PENDING }),
      ],
      remittances: [
        remittance('r-pending', t, 700, OfficeCashRemittanceStatus.PENDING),
        remittance('r-pending-outside', '2026-10-20T06:00:00Z', 700, OfficeCashRemittanceStatus.PENDING),
        remittance('r-ok', t, 50),
      ],
    };
    const Q = { from: '2026-09-01', to: '2026-09-30' };

    it('vendor scope: pending handovers (all vans) + pending owner transfers dated in the window', async () => {
      const { svc } = makeService(pendingData);
      const table = await svc.getDailySummary(VENDOR_ID, Q);
      const byKey = Object.fromEntries(table.rows.map((r) => [r.key, r]));
      // 10th: p1 + p-other + r-pending; 11th: p2 (a pending-only day still appears, and is not "empty")
      expect(byKey['2026-09-10'].pendingCount).toBe(3);
      expect(byKey['2026-09-11']).toMatchObject({ pendingCount: 1, entryCount: 0, isEmpty: false });
      expect(table.totals.pendingCount).toBe(4);
      // pending items never move the balance
      expect(byKey['2026-09-11']).toMatchObject({ opening: 950, closing: 950, net: 0 });
      // outside-window pending items are excluded
      expect(table.rows.map((r) => r.key)).toEqual(['2026-09-11', '2026-09-10']);
    });

    it('van scope: only that van\'s pending handovers; owner transfers are never queried', async () => {
      const { svc, prisma } = makeService(pendingData);
      const table = await svc.getDailySummary(VENDOR_ID, { ...Q, vanId: VAN_ID });
      const byKey = Object.fromEntries(table.rows.map((r) => [r.key, r]));
      expect(byKey['2026-09-10'].pendingCount).toBe(1); // p1 only (no remittance, no other van)
      expect(byKey['2026-09-11'].pendingCount).toBe(1);
      expect(table.totals.pendingCount).toBe(2);
      expect(prisma.officeCashRemittance.findMany).not.toHaveBeenCalled();
    });

    it('week grouping sums pending counts', async () => {
      const { svc } = makeService(pendingData);
      const table = await svc.getDailySummary(VENDOR_ID, { ...Q, group: 'week' });
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]).toMatchObject({ key: '2026-09-07', pendingCount: 4 });
    });
  });

  describe('defaults + derivation', () => {
    it('group defaults to day (service and DTO)', async () => {
      expect(new CashLedgerDailySummaryQueryDto().group).toBe('day');
      const { svc } = makeService({ expenses: [expense('e', '2026-09-10T06:00:00Z', 10)] });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-01', to: '2026-09-30' });
      expect(table.group).toBe('day');
      expect(table.rows[0].key).toBe('2026-09-10');
    });

    it('from absent -> derived from the first row; to absent -> today (PKT); range echoes null', async () => {
      const fixed = new Date('2026-09-14T06:00:00Z');
      jest.useFakeTimers({ now: fixed, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
      try {
        const { svc } = makeService({ expenses: [expense('e', '2026-09-10T06:00:00Z', 10)] });
        const table = await svc.getDailySummary(VENDOR_ID, { includeEmpty: true });
        expect(table.range).toEqual({ from: null, to: null });
        expect(table.rows.map((r) => r.key)).toEqual(['2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10']);
        expect(table.rows[0].closing).toBe(-10);
        expect(table.totals.broughtForward).toBe(0);
        expect(table.totals.expectedClosing).toBe(-10);
      } finally {
        jest.useRealTimers();
      }
    });

    it('no data at all -> no rows, zero totals', async () => {
      const { svc } = makeService({});
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2026-09-01', to: '2026-09-30' });
      expect(table.rows).toEqual([]);
      expect(table.totals).toMatchObject({ broughtForward: 0, expectedClosing: 0, entryCount: 0, lateCount: 0, pendingCount: 0 });
      expect(table.truncated).toBe(false);
    });
  });

  describe('row cap', () => {
    it('truncates at 366 rows (oldest dropped) but totals stay whole-range', async () => {
      const { svc } = makeService({
        manual: [manual('m', '2025-01-01T06:00:00Z', 100)],
        expenses: [expense('e', '2026-01-02T06:00:00Z', 1)],
      });
      const table = await svc.getDailySummary(VENDOR_ID, { from: '2025-01-01', to: '2026-01-02', includeEmpty: true });
      expect(table.truncated).toBe(true);
      expect(table.rows).toHaveLength(366);
      expect(table.rows[0].key).toBe('2026-01-02');
      expect(table.rows[365].key).toBe('2025-01-02');
      expect(table.totals.entryCount).toBe(2);
      expect(table.totals.expectedClosing).toBe(99);
    });
  });

  describe('DTO', () => {
    it('reads the raw includeEmpty query value (S46 pattern) — "false" is false, "true" is true', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const parse = async (raw: Record<string, unknown>) => {
        const dto = plainToInstance(CashLedgerDailySummaryQueryDto, raw, { enableImplicitConversion: true });
        return { dto, errors: await validate(dto) };
      };

      expect((await parse({ includeEmpty: 'false' })).dto.includeEmpty).toBe(false);
      expect((await parse({ includeEmpty: 'true' })).dto.includeEmpty).toBe(true);
      expect((await parse({})).dto.includeEmpty).toBeFalsy(); // absent -> unset (service treats it as false)
      expect((await parse({ group: 'week' })).errors).toHaveLength(0);
      expect((await parse({ group: 'year' })).errors.length).toBeGreaterThan(0);
      expect((await parse({ vanId: 'not-a-uuid' })).errors.length).toBeGreaterThan(0);
      expect((await parse({ from: '2026-09-01', to: '2026-09-30' })).errors).toHaveLength(0);
      expect((await parse({})).dto.group).toBe('day');
    });
  });
});
