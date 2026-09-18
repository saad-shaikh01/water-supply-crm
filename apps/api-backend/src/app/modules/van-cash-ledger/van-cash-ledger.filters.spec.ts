import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ExpenseCategory,
  FuelCardTopUpStatus,
  ManualCashInStatus,
  OfficeCashRemittanceDestination,
  OfficeCashRemittanceStatus,
  StandaloneCrewCashStatus,
  VanCashHandoverStatus,
} from '@prisma/client';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { VanCashLedgerTimelineQueryDto } from './dto/van-cash-ledger-query.dto';

/**
 * Cash Ledger P3 — timeline entry filters, end to end through
 * `VanCashLedgerService.getTimeline` over a small in-memory Prisma double that
 * really evaluates the `where` clauses (copied from van-cash-ledger.reads.spec.ts).
 * The pure filter semantics are unit-tested in cash-ledger-filters.spec.ts.
 */

const VENDOR_ID = 'vendor-001';
const VAN_ID = 'van-001';

// ─── in-memory prisma double (minimal copy of the reads.spec one) ───────────

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
  remittances?: any[];
  fuel?: any[];
  crew?: any[];
}

function makeService(data: Data, can: (userId: string, permission: string) => boolean = () => false) {
  const prisma: any = {
    vanCashHandover: model(data.handovers ?? []),
    vanCashOpeningBalance: model(data.manual ?? []),
    expense: model(data.expenses ?? []),
    staffLedgerEntry: model([]),
    settlement: model([]),
    officeCashRemittance: model(data.remittances ?? []),
    fuelCardTopUp: model(data.fuel ?? []),
    standaloneCrewCashExpense: model(data.crew ?? []),
  };
  const permissions = { can: jest.fn().mockImplementation(async (userId: string, permission: string) => can(userId, permission)) };
  const svc = new VanCashLedgerService(
    prisma,
    { log: jest.fn() } as any,
    permissions as any,
    { assertWritable: jest.fn().mockResolvedValue(undefined) } as any,
    { getClosedLabels: jest.fn().mockResolvedValue(new Set()), closedLabelsAmong: jest.fn().mockResolvedValue([]), isDateClosed: jest.fn().mockResolvedValue(false) } as any,
  );
  return { svc, prisma, permissions };
}

// ─── row builders ───────────────────────────────────────────────────────────

const d = (s: string) => new Date(s);

const SHEET_A = 'a1b2c3d4-1111-4111-8111-111111111111';
const SHEET_B = 'b2c3d4e5-2222-4222-8222-222222222222';
const U = {
  admin: '00000000-0000-4000-8000-0000000000a1',
  acc: '00000000-0000-4000-8000-0000000000a2',
  driver1: '00000000-0000-4000-8000-0000000000d1',
  driver2: '00000000-0000-4000-8000-0000000000d2',
  loader1: '00000000-0000-4000-8000-0000000000e1',
  loader2: '00000000-0000-4000-8000-0000000000e2',
};

function handover(id: string, date: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: VENDOR_ID,
    vanId: VAN_ID,
    dailySheetId: SHEET_A,
    amount,
    expectedAmount: amount,
    submittedById: U.driver1,
    approvedById: U.admin,
    date: d(date),
    status: VanCashHandoverStatus.APPROVED,
    correctsEntryId: null,
    version: 1,
    createdAt: d(date),
    van: { plateNumber: 'ABC-123' },
    submittedBy: { name: 'Driver One' },
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
    openingDate: d(openingDate),
    note: null,
    source: null,
    status: ManualCashInStatus.ACTIVE,
    version: 1,
    editCount: 0,
    lastEditedAt: null,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: d(openingDate),
    van: null,
    setById: U.admin,
    setBy: { name: 'Admin' },
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
    date: d(date),
    createdAt: d(date),
    dailySheetId: null,
    vanId: null,
    fuelLog: null,
    vehicleServiceRecord: null,
    van: null,
    createdById: U.acc,
    createdBy: { name: 'Accountant' },
    dailySheet: null,
    ...over,
  };
}

function remittance(
  id: string,
  date: string,
  amount: number,
  status: OfficeCashRemittanceStatus = OfficeCashRemittanceStatus.APPROVED,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: d(date),
    createdAt: d(date),
    destination: OfficeCashRemittanceDestination.BANK,
    destinationName: null,
    reference: null,
    status,
    correctsEntryId: null,
    version: 1,
    voidReason: null,
    submittedById: U.acc,
    approvedById: status === OfficeCashRemittanceStatus.APPROVED ? U.admin : null,
    submittedBy: { name: 'Accountant' },
    approvedBy: status === OfficeCashRemittanceStatus.APPROVED ? { name: 'Admin' } : null,
    voidedBy: null,
    ...over,
  };
}

function fuelTopUp(id: string, date: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: d(date),
    createdAt: d(date),
    reference: null,
    status: FuelCardTopUpStatus.ACTIVE,
    voidReason: null,
    fuelCard: { name: 'PSO Card' },
    createdById: U.acc,
    createdBy: { name: 'Accountant' },
    voidedBy: null,
    ...over,
  };
}

function crewCash(
  id: string,
  date: string,
  amount: number,
  status: StandaloneCrewCashStatus = StandaloneCrewCashStatus.ACTIVE,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: d(date),
    createdAt: d(date),
    category: 'MEAL',
    status,
    voidReason: null,
    editCount: 0,
    version: 1,
    employeeId: U.loader1,
    employee: { name: 'Loader One' },
    createdById: U.acc,
    createdBy: { name: 'Accountant' },
    voidedBy: null,
    notes: null,
    ...over,
  };
}

/**
 * PKT (UTC+5) days, all midday-ish UTC so the PKT day == the UTC day.
 *
 *   day 09-01: m1  +10000  (Owner injection, note)      -> 10000
 *              e2  -300    (BACKDATED: recorded 09-05)  ->  9700
 *   day 09-02: h1  +3000   (sheet A, driver1)           -> 12700
 *              e1  -500                                 -> 12200
 *   day 09-03: c1  -200    (crew MEAL, loader1)         -> 12000
 *              f1  -1000   (fuel card, ref PSO-1)       -> 11000
 *              c2  voided 700 (crew, loader2)           -> 11000
 *   day 09-04: r1  -2000   (BANK, ref TRX-9)            ->  9000
 *   + PENDING (only when status includes PENDING):
 *              hp  handover 800 (sheet B, driver2) 09-04T05Z ; rp remittance 600 OWNER 09-04T07Z
 */
function dataset(): Data {
  return {
    manual: [manual('m1', '2026-09-01T07:00:00Z', 10000, { note: 'Owner injection' })],
    expenses: [
      expense('e2', '2026-09-01T09:00:00Z', 300, { createdAt: d('2026-09-05T09:00:00Z'), category: ExpenseCategory.RENT }),
      expense('e1', '2026-09-02T09:00:00Z', 500),
    ],
    handovers: [
      handover('h1', '2026-09-02T06:00:00Z', 3000),
      handover('hp', '2026-09-04T05:00:00Z', 800, {
        status: VanCashHandoverStatus.PENDING,
        approvedById: null,
        approvedBy: null,
        dailySheetId: SHEET_B,
        submittedById: U.driver2,
        submittedBy: { name: 'Driver Two' },
      }),
    ],
    crew: [
      crewCash('c1', '2026-09-03T06:00:00Z', 200, StandaloneCrewCashStatus.ACTIVE, { notes: 'lunch' }),
      crewCash('c2', '2026-09-03T11:00:00Z', 700, StandaloneCrewCashStatus.VOIDED, {
        employeeId: U.loader2,
        employee: { name: 'Loader Two' },
      }),
    ],
    fuel: [fuelTopUp('f1', '2026-09-03T10:00:00Z', 1000, { reference: 'PSO-1' })],
    remittances: [
      remittance('r1', '2026-09-04T06:00:00Z', 2000, OfficeCashRemittanceStatus.APPROVED, { reference: 'TRX-9' }),
      remittance('rp', '2026-09-04T07:00:00Z', 600, OfficeCashRemittanceStatus.PENDING, {
        destination: OfficeCashRemittanceDestination.OWNER,
      }),
    ],
  };
}

const ids = (rows: Array<{ sourceRecordId: string }>) => rows.map((r) => r.sourceRecordId);
const byId = <T extends { sourceRecordId: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.sourceRecordId, r]));

const BASE_IDS_NEWEST_FIRST = ['r1', 'c2', 'f1', 'c1', 'e1', 'h1', 'e2', 'm1'];

describe('VanCashLedgerService — P3 timeline filters', () => {
  describe('filter-free call is unchanged', () => {
    it('lists only the base rows (no PENDING), no meta.filtered, newest first', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });

      expect(ids(page.data)).toEqual(BASE_IDS_NEWEST_FIRST);
      expect(page.meta.total).toBe(8);
      expect(page.meta.broughtForward).toBe(0);
      expect('filtered' in page.meta).toBe(false);
      expect(page.data.map((r) => r.runningBalance)).toEqual([9000, 11000, 11000, 12000, 12200, 12700, 9700, 10000]);
    });

    it('does not even query PENDING rows unless status includes PENDING', async () => {
      const { svc, prisma } = makeService(dataset());
      await svc.getTimeline(VENDOR_ID, { limit: 50, buckets: ['CREW_CASH'] });
      // Only the APPROVED-handover / APPROVED+VOIDED-remittance reads happened.
      expect(prisma.vanCashHandover.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.officeCashRemittance.findMany).toHaveBeenCalledTimes(1);
    });

    it('inert filter values (short q, false flags, empty lists) keep the call filter-free', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, {
        limit: 50,
        q: ' x ',
        buckets: [],
        status: [],
        backdatedOnly: false,
        hasNote: false,
      });
      expect(ids(page.data)).toEqual(BASE_IDS_NEWEST_FIRST);
      expect('filtered' in page.meta).toBe(false);
    });
  });

  describe('row id fields', () => {
    it('every row carries recordedById / approvedById / destination', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const rows = byId(page.data);

      expect(rows['m1'].recordedById).toBe(U.admin);
      expect(rows['h1'].recordedById).toBe(U.driver1);
      expect(rows['h1'].approvedById).toBe(U.admin);
      expect(rows['e1'].recordedById).toBe(U.acc);
      expect(rows['c1'].recordedById).toBe(U.acc);
      expect(rows['f1'].recordedById).toBe(U.acc);
      expect(rows['r1'].recordedById).toBe(U.acc);
      expect(rows['r1'].approvedById).toBe(U.admin);
      expect(rows['r1'].destination).toBe('BANK');
      // Everything else: null, never undefined.
      expect(rows['e1'].approvedById).toBeNull();
      expect(rows['e1'].destination).toBeNull();
      expect(rows['h1'].destination).toBeNull();
    });
  });

  describe('each filter through the service', () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ['buckets (OR)', { buckets: ['CREW_CASH', 'FUEL_CARD'] }, ['c2', 'f1', 'c1']],
      ['status VOIDED', { status: ['VOIDED'] }, ['c2']],
      ['status APPROVED (not voided, not pending)', { status: ['APPROVED'] }, ['r1', 'f1', 'c1', 'e1', 'h1', 'e2', 'm1']],
      ['recordedById (accountant)', { recordedById: U.acc }, ['r1', 'c2', 'f1', 'c1', 'e1', 'e2']],
      ['approvedById', { approvedById: U.admin }, ['r1', 'h1']],
      ['employeeId (crew loader)', { employeeId: U.loader1 }, ['c1']],
      ['employeeId (handover driver)', { employeeId: U.driver1 }, ['h1']],
      ['categories', { categories: ['RENT', 'MEAL'] }, ['c2', 'c1', 'e2']],
      ['minAmount', { minAmount: 2000 }, ['r1', 'h1', 'm1']],
      ['maxAmount', { maxAmount: 300 }, ['c1', 'e2']],
      ['amount range', { minAmount: 500, maxAmount: 1000 }, ['c2', 'f1', 'e1']],
      ['hasNote', { hasNote: true }, ['c1', 'm1']],
      ['backdatedOnly', { backdatedOnly: true }, ['e2']],
      ['sheet prefix (#a1b2)', { sheet: '#a1b2' }, ['h1']],
      ['reference contains', { reference: 'trx' }, ['r1']],
      ['destination', { destination: 'BANK' }, ['r1']],
      ['q on title', { q: 'owner injection' }, ['m1']],
      ['q on recordedByName', { q: 'driver one' }, ['h1']],
      ['q on sheet short id', { q: 'a1b2c3' }, ['h1']],
      ['q numeric amount', { q: '1000' }, ['f1']],
      ['recordedFrom (PKT day of createdAt)', { recordedFrom: '2026-09-05' }, ['e2']],
      ['recordedTo (PKT day of createdAt)', { recordedTo: '2026-09-01' }, ['m1']],
    ];

    it.each(cases)('%s', async (_name, filters, expected) => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, ...filters });
      expect(ids(page.data)).toEqual(expected);
      expect(page.meta.total).toBe(expected.length);
      expect(page.meta.filtered?.active).toBe(true);
      expect(page.meta.filtered?.count).toBe(expected.length);
    });

    it('AND across groups: buckets [CREW_CASH, FUEL_CARD] + recordedBy accountant + amount >= 500', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, {
        limit: 50,
        buckets: ['CREW_CASH', 'FUEL_CARD'],
        recordedById: U.acc,
        minAmount: 500,
      });
      expect(ids(page.data)).toEqual(['c2', 'f1']);
    });

    it('editedOnly picks manual / crew rows with editCount > 0', async () => {
      const data = dataset();
      data.manual = [manual('m1', '2026-09-01T07:00:00Z', 10000, { editCount: 2, lastEditedAt: d('2026-09-02T00:00:00Z') })];
      const { svc } = makeService(data);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, editedOnly: true });
      expect(ids(page.data)).toEqual(['m1']);
    });

    it('rejects minAmount > maxAmount with a 400', async () => {
      const { svc } = makeService(dataset());
      await expect(svc.getTimeline(VENDOR_ID, { minAmount: 10, maxAmount: 5 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts the buckets[] / status[] alias keys Express 5 leaves un-folded', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, 'buckets[]': ['FUEL_CARD'] } as any);
      expect(ids(page.data)).toEqual(['f1']);
    });
  });

  describe('recordedFrom / recordedTo PKT day boundary', () => {
    it('23:30 PKT belongs to the previous day, 00:30 PKT to the next', async () => {
      // 2026-09-10T18:30Z = 23:30 PKT 10 Sep ; 2026-09-10T19:30Z = 00:30 PKT 11 Sep.
      const { svc } = makeService({
        expenses: [
          expense('late', '2026-09-10T09:00:00Z', 10, { createdAt: d('2026-09-10T18:30:00Z') }),
          expense('early', '2026-09-10T09:00:00Z', 20, { createdAt: d('2026-09-10T19:30:00Z') }),
        ],
      });
      const from11 = await svc.getTimeline(VENDOR_ID, { limit: 50, recordedFrom: '2026-09-11' });
      expect(ids(from11.data)).toEqual(['early']);
      const to10 = await svc.getTimeline(VENDOR_ID, { limit: 50, recordedTo: '2026-09-10' });
      expect(ids(to10.data)).toEqual(['late']);
    });
  });

  describe('I5 — filters never change balances or day statements', () => {
    it('surviving rows keep their unfiltered runningBalance; dayStatements equal the unfiltered ones', async () => {
      const { svc } = makeService(dataset());
      const full = await svc.getTimeline(VENDOR_ID, { limit: 100 });
      const filtered = await svc.getTimeline(VENDOR_ID, { limit: 100, buckets: ['CREW_CASH', 'FUEL_CARD'] });

      expect(ids(filtered.data)).toEqual(['c2', 'f1', 'c1']);
      const fullById = byId(full.data);
      for (const row of filtered.data) expect(row.runningBalance).toBe(fullById[row.sourceRecordId].runningBalance);

      // Only the days on the filtered page, but each one is the WHOLE-day, unfiltered statement.
      expect(Object.keys(filtered.meta.dayStatements)).toEqual(['2026-09-03']);
      expect(filtered.meta.dayStatements['2026-09-03']).toEqual(full.meta.dayStatements['2026-09-03']);
      expect(filtered.meta.dayStatements['2026-09-03'].entryCount).toBe(3);
      expect(filtered.meta.dayStatements['2026-09-03'].opening).toBe(12200);
      expect(filtered.meta.broughtForward).toBe(full.meta.broughtForward);
    });

    it('a backdated-only filter still reports the true day counts and the row in-sequence balance', async () => {
      const { svc } = makeService(dataset());
      const full = await svc.getTimeline(VENDOR_ID, { limit: 100 });
      const filtered = await svc.getTimeline(VENDOR_ID, { limit: 100, backdatedOnly: true });

      expect(ids(filtered.data)).toEqual(['e2']);
      // 10000 (m1, hidden by the filter) - 300: the balance is the true in-sequence one, not -300.
      expect(filtered.data[0].runningBalance).toBe(9700);
      expect(filtered.meta.dayStatements['2026-09-01']).toEqual(full.meta.dayStatements['2026-09-01']);
      expect(filtered.meta.dayStatements['2026-09-01'].entryCount).toBe(2);
      expect(filtered.meta.dayStatements['2026-09-01'].lateCount).toBe(1);
    });

    it('holds with a brought-forward window and a van scope too', async () => {
      const { svc } = makeService(dataset());
      const query = { from: '2026-09-02', limit: 100 };
      const full = await svc.getTimeline(VENDOR_ID, query);
      const filtered = await svc.getTimeline(VENDOR_ID, { ...query, q: 'expense' });
      const fullById = byId(full.data);
      expect(filtered.meta.broughtForward).toBe(full.meta.broughtForward);
      for (const row of filtered.data) expect(row.runningBalance).toBe(fullById[row.sourceRecordId].runningBalance);

      const van = await svc.getTimeline(VENDOR_ID, { vanId: VAN_ID, limit: 100 });
      const vanFiltered = await svc.getTimeline(VENDOR_ID, { vanId: VAN_ID, limit: 100, q: 'handover' });
      expect(ids(vanFiltered.data)).toEqual(['h1']);
      expect(vanFiltered.data[0].runningBalance).toBe(byId(van.data)['h1'].runningBalance);
    });
  });

  describe('pagination over the FILTERED set', () => {
    it('page size 2: total/totalPages reflect the filtered count; pages concatenate to the filtered list', async () => {
      const { svc } = makeService(dataset());
      // 5 rows survive: r1, c2, f1, c1, e1 (recorded by the accountant, bucket != cash-in, day >= 09-02).
      const query = { limit: 2, recordedById: U.acc, recordedFrom: '2026-09-02', recordedTo: '2026-09-04' };
      const p1 = await svc.getTimeline(VENDOR_ID, { ...query, page: 1 });
      const p2 = await svc.getTimeline(VENDOR_ID, { ...query, page: 2 });
      const p3 = await svc.getTimeline(VENDOR_ID, { ...query, page: 3 });

      expect(ids(p1.data)).toEqual(['r1', 'c2']);
      expect(ids(p2.data)).toEqual(['f1', 'c1']);
      expect(ids(p3.data)).toEqual(['e1']);
      for (const p of [p1, p2, p3]) {
        expect(p.meta.total).toBe(5);
        expect(p.meta.totalPages).toBe(3);
        expect(p.meta.filtered?.count).toBe(5);
      }
      // Day statements follow the page: page 1 -> 09-04 and 09-03; page 3 -> 09-02 only.
      expect(Object.keys(p1.meta.dayStatements).sort()).toEqual(['2026-09-03', '2026-09-04']);
      expect(Object.keys(p3.meta.dayStatements)).toEqual(['2026-09-02']);
    });
  });

  describe('meta.filtered subtotal', () => {
    it('totalIn / totalOut over the whole filtered set (not just the page); voided contributes 0', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 1, buckets: ['CREW_CASH', 'FUEL_CARD'] });
      expect(page.data).toHaveLength(1);
      // c1 -200, f1 -1000, c2 voided (0).
      expect(page.meta.filtered).toEqual({ active: true, count: 3, totalIn: 0, totalOut: 1200 });
    });

    it('cash-in and cash-out are split', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, buckets: ['SHEET_CASH_IN', 'OFFICE_CASH_IN', 'OFFICE_EXPENSE'] });
      // m1 +10000, h1 +3000 ; e2 -300, e1 -500.
      expect(page.meta.filtered).toEqual({ active: true, count: 4, totalIn: 13000, totalOut: 800 });
    });

    it('a filter that matches nothing is still "active" with zero totals', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, q: 'no-such-thing' });
      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
      expect(page.meta.filtered).toEqual({ active: true, count: 0, totalIn: 0, totalOut: 0 });
    });
  });

  describe('PENDING rows (memo)', () => {
    it('appear only with status=PENDING; amount 0, real figure in displayAmount, status PENDING', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, status: ['PENDING'] });

      expect(ids(page.data)).toEqual(['rp', 'hp']);
      const rows = byId(page.data);
      expect(rows['hp']).toMatchObject({ amount: 0, displayAmount: 800, status: 'PENDING', type: 'CASH_IN', version: 1 });
      expect(rows['rp']).toMatchObject({ amount: 0, displayAmount: 600, status: 'PENDING', type: 'CASH_REMITTANCE_OUT', version: 1 });
      expect(rows['hp'].recordedById).toBe(U.driver2);
      expect(rows['rp'].destination).toBe('OWNER');
    });

    it('carry the running balance of the preceding BASE row and contribute 0 to totals', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, status: ['PENDING'] });
      const rows = byId(page.data);

      // hp (05Z) sits after c2 (day 09-03, 11000) and before r1 (06Z) ; rp (07Z) sits after r1 (9000).
      expect(rows['hp'].runningBalance).toBe(11000);
      expect(rows['rp'].runningBalance).toBe(9000);
      expect(page.meta.filtered).toEqual({ active: true, count: 2, totalIn: 0, totalOut: 0 });
    });

    it('do not perturb the base rows: PENDING + APPROVED shows both, base balances unchanged, dayStatements unchanged', async () => {
      const { svc } = makeService(dataset());
      const base = await svc.getTimeline(VENDOR_ID, { limit: 100 });
      const both = await svc.getTimeline(VENDOR_ID, { limit: 100, status: ['PENDING', 'APPROVED'] });

      // c2 is voided -> neither PENDING nor APPROVED.
      expect(ids(both.data)).toEqual(['rp', 'r1', 'hp', 'f1', 'c1', 'e1', 'h1', 'e2', 'm1']);
      const baseById = byId(base.data);
      for (const row of both.data.filter((r) => r.status !== 'PENDING')) {
        expect(row.runningBalance).toBe(baseById[row.sourceRecordId].runningBalance);
      }
      // entryCount / lateCount / buckets only ever count base rows.
      expect(both.meta.dayStatements['2026-09-04']).toEqual(base.meta.dayStatements['2026-09-04']);
      expect(both.meta.dayStatements['2026-09-04'].entryCount).toBe(1);
      expect(both.meta.dayStatements['2026-09-04'].ownerTransfer).toBe(2000);
      expect(both.meta.filtered).toEqual({ active: true, count: 9, totalIn: 13000, totalOut: 4000 });
    });

    it('a PENDING status combined with another group still ANDs (bucket OWNER_TRANSFER -> only the remittance)', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, status: ['PENDING'], buckets: ['OWNER_TRANSFER'] });
      expect(ids(page.data)).toEqual(['rp']);
    });

    it('van scope: the vendor-wide pending remittance is hidden, the van handover stays', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { vanId: VAN_ID, limit: 50, status: ['PENDING'] });
      expect(ids(page.data)).toEqual(['hp']);
    });

    it('respects the date window (a pending row outside from/to is not listed)', async () => {
      const { svc } = makeService(dataset());
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, status: ['PENDING'], from: '2026-09-05' });
      expect(page.data).toEqual([]);
    });

    it('status=[VOIDED] alone never loads pending rows', async () => {
      const { svc, prisma } = makeService(dataset());
      await svc.getTimeline(VENDOR_ID, { limit: 50, status: ['VOIDED'] });
      expect(prisma.vanCashHandover.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-row permissions still apply on the filtered page', () => {
    it('canVoid / canEdit are stamped on the returned (filtered) rows', async () => {
      const { svc } = makeService(dataset(), (_user, permission) => permission === 'crew_cash:delete' || permission === 'crew_cash:edit');
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50, buckets: ['CREW_CASH'] }, { userId: 'u', vendorId: VENDOR_ID } as any);
      const rows = byId(page.data);
      expect(rows['c1'].canVoid).toBe(true);
      expect(rows['c1'].canEdit).toBe(true);
      // Voided crew cash can never be voided or edited again.
      expect(rows['c2'].canVoid).toBe(false);
      expect(rows['c2'].canEdit).toBe(false);
    });
  });
});

describe('VanCashLedgerTimelineQueryDto — query-string handling (global ValidationPipe config)', () => {
  // Exactly the pipe main.ts installs.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (query: Record<string, unknown>) =>
    pipe.transform(query, { type: 'query', metatype: VanCashLedgerTimelineQueryDto }) as Promise<VanCashLedgerTimelineQueryDto>;

  it('no filters -> nothing set, pagination defaults kept', async () => {
    const dto = await run({});
    expect(dto.buckets).toBeUndefined();
    expect(dto.backdatedOnly).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('a single value becomes an array; repeated keys, comma lists and blank entries normalise', async () => {
    expect((await run({ buckets: 'CREW_CASH' })).buckets).toEqual(['CREW_CASH']);
    expect((await run({ buckets: ['CREW_CASH', 'FUEL_CARD'] })).buckets).toEqual(['CREW_CASH', 'FUEL_CARD']);
    expect((await run({ buckets: 'CREW_CASH,FUEL_CARD' })).buckets).toEqual(['CREW_CASH', 'FUEL_CARD']);
    expect((await run({ status: 'PENDING' })).status).toEqual(['PENDING']);
    expect((await run({ categories: 'MEAL' })).categories).toEqual(['MEAL']);
    expect((await run({ categories: ['MEAL', 'RENT'] })).categories).toEqual(['MEAL', 'RENT']);
    expect((await run({ buckets: '' })).buckets).toBeUndefined();
  });

  it("accepts the literal `buckets[]` / `status[]` / `categories[]` keys (axios default under Express 5's simple parser)", async () => {
    const dto = await run({ 'buckets[]': ['CREW_CASH', 'FUEL_CARD'], 'status[]': 'PENDING', 'categories[]': ['MEAL'] });
    expect(dto['buckets[]']).toEqual(['CREW_CASH', 'FUEL_CARD']);
    expect(dto['status[]']).toEqual(['PENDING']);
    expect(dto['categories[]']).toEqual(['MEAL']);
  });

  it("boolean strings 'true' / 'false' parse correctly (S46: 'false' must NOT become true)", async () => {
    const dto = await run({ backdatedOnly: 'true', editedOnly: 'false', hasAttachment: 'true', hasNote: 'false' });
    expect(dto.backdatedOnly).toBe(true);
    expect(dto.editedOnly).toBe(false);
    expect(dto.hasAttachment).toBe(true);
    expect(dto.hasNote).toBe(false);
  });

  it('numbers are coerced; min > max is a 400', async () => {
    const dto = await run({ minAmount: '100', maxAmount: '2500.5' });
    expect(dto.minAmount).toBe(100);
    expect(dto.maxAmount).toBe(2500.5);
    await expect(run({ minAmount: '10', maxAmount: '5' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ minAmount: '-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ minAmount: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates enums, uuids, dates and the q length', async () => {
    await expect(run({ buckets: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ status: 'DONE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ destination: 'MOON' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ recordedById: 'not-a-uuid' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ recordedFrom: 'yesterday' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ q: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
    const ok = await run({
      destination: 'CEO',
      recordedById: U.acc,
      approvedById: U.admin,
      employeeId: U.loader1,
      recordedFrom: '2026-09-01',
      recordedTo: '2026-09-30T10:00:00Z',
      sheet: '#a1b2',
      reference: 'trx',
      q: 'ab',
    });
    expect(ok.destination).toBe('CEO');
    expect(ok.sheet).toBe('#a1b2');
  });

  it('still rejects unknown keys (forbidNonWhitelisted)', async () => {
    await expect(run({ bogus: '1' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
