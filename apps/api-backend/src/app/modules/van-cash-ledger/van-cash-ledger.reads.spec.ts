import { NotFoundException } from '@nestjs/common';
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
import { buildStatement } from './cash-ledger-statement';
import { STANDALONE_CREW_CASH_LOCKED_REASON } from '../payroll/standalone-crew-cash-lock.util';

/**
 * Read-side (timeline / stats / available balance) tests for the Cash Ledger P0
 * redesign. Uses a tiny in-memory Prisma double that actually EVALUATES the
 * `where` clauses the service builds (equality, `in`, `lt/lte/gte`, null) — so
 * the PKT window, the van-scoping and the R6 payroll-cash filters are exercised
 * for real rather than asserted against a canned mock.
 */

const VENDOR_ID = 'vendor-001';
const VAN_ID = 'van-001';
const OTHER_VAN_ID = 'van-002';

// ─── in-memory prisma double ────────────────────────────────────────────────

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
  /** DailySheet rows (id, vendorId, date, cashCollected) — read by the sheet breakdown. */
  sheets?: any[];
  /** CrewCashDistribution rows (dailySheetId, amount) — read by the sheet breakdown. */
  crewDist?: any[];
  /** AuditLog rows — read by the entry history. */
  audit?: any[];
  /** Van rows (id, vendorId, plateNumber) — batched plate-number lookup in the history diff. */
  vans?: any[];
  /** User rows (id, vendorId, name) — batched employee / actor lookup in the history. */
  users?: any[];
  /** Rows for the other history record loaders. */
  expensesById?: any[];
  staffAudit?: any[];
}

function makeReadService(
  data: Data = {},
  can: (userId: string, permission: string) => boolean = () => false,
  /** "YYYY-MM" labels of CLOSED accounting periods (P4). */
  closedPeriods: string[] = [],
) {
  const prisma: any = {
    vanCashHandover: model(data.handovers ?? []),
    vanCashOpeningBalance: model(data.manual ?? []),
    expense: model(data.expenses ?? []),
    staffLedgerEntry: model(data.ledger ?? []),
    settlement: model(data.settlements ?? []),
    officeCashRemittance: model(data.remittances ?? []),
    fuelCardTopUp: model(data.fuel ?? []),
    standaloneCrewCashExpense: model(data.crew ?? []),
    dailySheet: model(data.sheets ?? []),
    crewCashDistribution: model(data.crewDist ?? []),
    auditLog: model(data.audit ?? []),
    van: model(data.vans ?? []),
    user: model(data.users ?? []),
    staffLedgerAuditLog: model(data.staffAudit ?? []),
  };
  const permissions = { can: jest.fn().mockImplementation(async (userId: string, permission: string) => can(userId, permission)) };
  const periodGuard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const closedSet = new Set(closedPeriods);
  const periodStore = {
    getClosedLabels: jest.fn().mockImplementation(async () => new Set(closedSet)),
    closedLabelsAmong: jest.fn().mockResolvedValue([]),
    isDateClosed: jest.fn().mockResolvedValue(false),
  };
  const svc = new VanCashLedgerService(prisma, { log: jest.fn() } as any, permissions as any, periodGuard as any, periodStore as any);
  return { svc, prisma, permissions, periodGuard, periodStore };
}

// ─── row builders (full shape the normalisers read) ─────────────────────────

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

function settlement(id: string, method: SettlementMethod, amount: number, paidAt: string, employee = 'Bilal') {
  return {
    id,
    vendorId: VENDOR_ID,
    method,
    amount,
    paidAt: iso(paidAt),
    createdAt: iso(paidAt),
    payrollEntry: { user: { name: employee } },
    paidBy: { name: 'Accountant' },
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
    ...over,
  };
}

function fuelTopUp(
  id: string,
  date: string,
  amount: number,
  status: FuelCardTopUpStatus = FuelCardTopUpStatus.ACTIVE,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    vendorId: VENDOR_ID,
    amount,
    date: iso(date),
    createdAt: iso(date),
    reference: null,
    status,
    voidReason: null,
    fuelCard: { name: 'PSO Card' },
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
    date: iso(date),
    createdAt: iso(date),
    category: 'MEAL',
    status,
    voidReason: null,
    employee: { name: 'Loader' },
    createdBy: { name: 'Accountant' },
    ...over,
  };
}

const balances = (rows: Array<{ sourceRecordId: string; runningBalance: number }>) =>
  Object.fromEntries(rows.map((r) => [r.sourceRecordId, r.runningBalance]));

// ─── tests ──────────────────────────────────────────────────────────────────

describe('VanCashLedgerService — Cash Ledger P0 reads', () => {
  describe('bug 1: brought-forward / running-balance window', () => {
    const data: Data = {
      // Before the window — must seed the fold, and must NOT appear as rows.
      manual: [manual('m-old', '2026-08-01T00:00:00Z', 10000)],
      handovers: [
        handover('h-old', '2026-08-05T00:00:00Z', 5000),
        handover('h-in', '2026-09-02T00:00:00Z', 3000),
      ],
      expenses: [expense('e-old', '2026-08-10T06:00:00Z', 2000), expense('e-in', '2026-09-03T06:00:00Z', 500)],
    };

    it('rows before `from` seed the fold; the first in-window row already carries the true balance', async () => {
      const { svc } = makeReadService(data);

      const page = await svc.getTimeline(VENDOR_ID, { from: '2026-09-01', limit: 50 });

      // 10000 + 5000 - 2000 = 13000 brought forward.
      expect(page.meta.broughtForward).toBe(13000);
      // Only the two in-window rows are listed (old manual entry no longer leaks in).
      expect(page.data.map((r) => r.sourceRecordId)).toEqual(['e-in', 'h-in']);
      // Newest-first display, balances folded oldest-first from 13000.
      expect(balances(page.data)).toEqual({
        'e-in': 15500,
        'h-in': 16000,
      });
    });

    it('with no `from`, broughtForward is 0 and all history is in-window', async () => {
      const { svc } = makeReadService(data);

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });

      expect(page.meta.broughtForward).toBe(0);
      expect(page.meta.total).toBe(5);
      expect(page.data[0].runningBalance).toBe(15500); // 10000+5000-2000+3000-500
    });

    it('manual cash-in uses the SAME window as every other source (from AND to)', async () => {
      const { svc } = makeReadService({
        manual: [
          manual('m1', '2026-08-01T00:00:00Z', 1000),
          manual('m2', '2026-09-05T00:00:00Z', 2000),
          manual('m3', '2026-10-05T00:00:00Z', 4000),
        ],
      });

      const page = await svc.getTimeline(VENDOR_ID, { from: '2026-09-01', to: '2026-09-30', limit: 50 });

      expect(page.meta.broughtForward).toBe(1000);
      expect(page.data.map((r) => r.sourceRecordId)).toEqual(['m2']);
      expect(page.data[0].runningBalance).toBe(3000);
    });

    it('I2: stats.availableBalance == broughtForward + net for a range ending at the latest row', async () => {
      const { svc } = makeReadService({
        ...data,
        remittances: [remittance('r1', '2026-09-04T06:00:00Z', 1000)],
        fuel: [fuelTopUp('f1', '2026-09-04T07:00:00Z', 200)],
        crew: [crewCash('c1', '2026-09-04T08:00:00Z', 100)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -700, '2026-09-04T09:00:00Z')],
        settlements: [settlement('s1', SettlementMethod.CASH, 1300, '2026-09-04T10:00:00Z')],
      });
      const query = { from: '2026-09-01', to: '2026-09-30' };

      const stats = await svc.getStats(VENDOR_ID, query);
      const timeline = await svc.getTimeline(VENDOR_ID, { ...query, limit: 100 });

      expect(stats.broughtForward).toBe(13000);
      expect(stats.expectedClosing).toBe(stats.availableBalance);
      // brought forward + net of the period
      expect(stats.availableBalance).toBe(
        stats.broughtForward + stats.totalCashIn - stats.totalExpense - stats.totalRemitted - stats.totalFuelCardTopUps,
      );
      // ...and it equals the last running balance the timeline shows (newest row first).
      expect(timeline.data[0].runningBalance).toBe(stats.availableBalance);
      // 13000 + 3000 - (500 + 2000 payroll + 100 crew) - 1000 owner - 200 fuel = 12200
      expect(stats.availableBalance).toBe(12200);
    });

    it('the pure statement fold over the timeline rows agrees with the stats aggregates', async () => {
      const { svc } = makeReadService({
        ...data,
        remittances: [remittance('r1', '2026-09-04T06:00:00Z', 1000)],
        crew: [crewCash('c1', '2026-09-04T08:00:00Z', 100)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -700, '2026-09-04T09:00:00Z')],
      });
      const query = { from: '2026-09-01', to: '2026-09-30' };

      const stats = await svc.getStats(VENDOR_ID, query);
      const timeline = await svc.getTimeline(VENDOR_ID, { ...query, limit: 100 });
      const statement = buildStatement(timeline.data, timeline.meta.broughtForward);

      expect(statement.sheetCashIn).toBe(stats.sheetCashIn);
      expect(statement.officeCashIn).toBe(stats.officeCashIn);
      expect(statement.officeExpenses).toBe(stats.officeExpenses);
      expect(statement.payrollCash).toBe(stats.payrollCash);
      expect(statement.crewCash).toBe(stats.crewCash);
      expect(statement.ownerTransfer).toBe(stats.totalRemitted);
      expect(statement.totalCashIn).toBe(stats.totalCashIn);
      expect(statement.totalExpenses).toBe(stats.totalExpense);
      expect(statement.expectedClosing).toBe(stats.expectedClosing);
    });
  });

  describe('bug 2: deterministic ordering', () => {
    it('same-day rows with an identical `date` order by createdAt, then bucket rank — no artificial negative dip', async () => {
      const day = '2026-09-10T00:00:00Z';
      const { svc } = makeReadService({
        // Every row shares the SAME `date` AND the same createdAt. The old
        // id-string sort would put "CASH_OUT:..." before "OPENING_BALANCE:..." and
        // fold the 4000 expense first, dipping the balance to -4000.
        manual: [manual('m1', day, 5000)],
        expenses: [expense('e1', day, 4000)],
      });

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const oldestFirst = [...page.data].reverse();

      expect(oldestFirst.map((r) => r.bucket)).toEqual(['OFFICE_CASH_IN', 'OFFICE_EXPENSE']);
      expect(oldestFirst.map((r) => r.runningBalance)).toEqual([5000, 1000]);
      expect(Math.min(...page.data.map((r) => r.runningBalance))).toBeGreaterThanOrEqual(0);
    });

    it('same `date`, different createdAt: the earlier-created row folds first', async () => {
      const day = '2026-09-10T00:00:00Z';
      const { svc } = makeReadService({
        manual: [manual('m1', day, 5000, { createdAt: iso('2026-09-10T12:00:00Z') })],
        // Cash-out created EARLIER than the cash-in on the same day: createdAt
        // wins over bucket rank, so it folds first.
        expenses: [expense('e1', day, 4000, { createdAt: iso('2026-09-10T08:00:00Z') })],
      });

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      expect([...page.data].reverse().map((r) => r.sourceRecordId)).toEqual(['e1', 'm1']);
    });

    it('populates createdAt (ISO) and bucket on every source', async () => {
      const t = '2026-09-10T06:00:00Z';
      const { svc } = makeReadService({
        handovers: [handover('h', t, 100)],
        manual: [manual('m', t, 100)],
        expenses: [expense('e', t, 10)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -10, t)],
        settlements: [settlement('s', SettlementMethod.CASH, 10, t)],
        remittances: [remittance('r', t, 10)],
        fuel: [fuelTopUp('f', t, 10)],
        crew: [crewCash('c', t, 10)],
      });

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });

      const byBucket = Object.fromEntries(page.data.map((r) => [r.bucket, r]));
      expect(Object.keys(byBucket).sort()).toEqual(
        ['CREW_CASH', 'FUEL_CARD', 'OFFICE_CASH_IN', 'OFFICE_EXPENSE', 'OWNER_TRANSFER', 'PAYROLL_CASH', 'SHEET_CASH_IN'].sort(),
      );
      for (const row of page.data) expect(row.createdAt).toBe(new Date(t).toISOString());
      expect(byBucket.SHEET_CASH_IN.type).toBe('CASH_IN');
      expect(byBucket.OFFICE_CASH_IN.type).toBe('OPENING_BALANCE');
      expect(byBucket.OWNER_TRANSFER.type).toBe('CASH_REMITTANCE_OUT');
      expect(byBucket.FUEL_CARD.type).toBe('FUEL_CARD_TOPUP_OUT');
      expect(byBucket.CREW_CASH.type).toBe('STANDALONE_CREW_CASH_OUT');
    });
  });

  describe('I8: payroll cash (R6) — only entries that actually moved cash', () => {
    const t = '2026-09-10T06:00:00Z';
    const P = LedgerEntryStatus.POSTED;
    const C = StaffLedgerCategory;
    const data: Data = {
      ledger: [
        ledgerEntry('adv-ok', C.ADVANCE, P, -5000, t), // INCLUDED
        ledgerEntry('adv-pending', C.ADVANCE, LedgerEntryStatus.PENDING, -1000, t),
        ledgerEntry('adv-voided', C.ADVANCE, LedgerEntryStatus.VOIDED, -300, t),
        ledgerEntry('adv-positive', C.ADVANCE, P, 700, t), // anomaly
        ledgerEntry('penalty', C.PENALTY, P, -100, t),
        ledgerEntry('deduction', C.DEDUCTION, P, -200, t),
        ledgerEntry('leave-unpaid', C.LEAVE_UNPAID, P, -900, t),
        ledgerEntry('reversal', C.REVERSAL, P, -50, t),
        ledgerEntry('correction', C.CORRECTION, P, -60, t),
        ledgerEntry('bonus', C.BONUS, P, 800, t),
        ledgerEntry('crew-cash', C.CREW_CASH, P, -400, t),
      ],
      settlements: [
        settlement('set-cash', SettlementMethod.CASH, 25000, t, 'Ahmed'), // INCLUDED
        settlement('set-bank', SettlementMethod.BANK_TRANSFER, 9000, t),
        settlement('set-cheque', SettlementMethod.CHEQUE, 8000, t),
      ],
    };

    it('stats: ADVANCE -5,000 (POSTED) + CASH settlement 25,000 = 30,000 payroll cash; everything else excluded', async () => {
      const { svc } = makeReadService(data);

      const stats = await svc.getStats(VENDOR_ID, {});

      expect(stats.payrollCash).toBe(30000);
      expect(stats.totalExpense).toBe(30000);
      expect(stats.availableBalance).toBe(-30000);
      expect(stats.crewCash).toBe(0); // the CREW_CASH ledger entry is never double-read
    });

    it('timeline: advances stay CASH_OUT/STAFF_LEDGER, settlements are PAYROLL_SETTLEMENT_OUT/SETTLEMENT', async () => {
      const { svc } = makeReadService(data);

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });

      expect(page.data).toHaveLength(2);
      const advance = page.data.find((r) => r.sourceRecordId === 'adv-ok')!;
      expect(advance).toMatchObject({
        type: 'CASH_OUT',
        sourceType: 'STAFF_LEDGER',
        bucket: 'PAYROLL_CASH',
        amount: -5000,
        sourceBadge: 'via Payroll',
      });
      const paid = page.data.find((r) => r.sourceRecordId === 'set-cash')!;
      expect(paid).toMatchObject({
        id: 'PAYROLL_SETTLEMENT_OUT:set-cash',
        type: 'PAYROLL_SETTLEMENT_OUT',
        sourceType: 'SETTLEMENT',
        sourceBadge: 'via Payroll',
        bucket: 'PAYROLL_CASH',
        title: 'Salary paid in cash — Ahmed',
        amount: -25000,
        displayAmount: 25000,
      });
      expect(page.data[0].runningBalance).toBe(-30000);
    });

    it('the queries filter on the R6 definition (ADVANCE/POSTED/debit; method CASH) in BOTH the rows and the aggregate', async () => {
      const { svc, prisma } = makeReadService(data);
      await svc.getStats(VENDOR_ID, {});
      await svc.getTimeline(VENDOR_ID, {});

      const advanceWhere = expect.objectContaining({
        category: StaffLedgerCategory.ADVANCE,
        status: LedgerEntryStatus.POSTED,
        amount: { lt: 0 },
      });
      expect(prisma.staffLedgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: advanceWhere }));
      expect(prisma.staffLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: advanceWhere }));
      const cashWhere = expect.objectContaining({ method: SettlementMethod.CASH });
      expect(prisma.settlement.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: cashWhere }));
      expect(prisma.settlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: cashWhere }));
    });

    it('payroll cash is dated by effectiveDate / paidAt and respects the window', async () => {
      const { svc } = makeReadService({
        ledger: [
          ledgerEntry('adv-aug', C.ADVANCE, P, -1000, '2026-08-20T06:00:00Z'),
          ledgerEntry('adv-sep', C.ADVANCE, P, -2000, '2026-09-20T06:00:00Z'),
        ],
        settlements: [
          settlement('set-aug', SettlementMethod.CASH, 4000, '2026-08-25T06:00:00Z'),
          settlement('set-sep', SettlementMethod.CASH, 8000, '2026-09-25T06:00:00Z'),
        ],
      });

      const stats = await svc.getStats(VENDOR_ID, { from: '2026-09-01', to: '2026-09-30' });

      expect(stats.payrollCash).toBe(10000);
      expect(stats.broughtForward).toBe(-5000);
      expect(stats.expectedClosing).toBe(-15000);
    });
  });

  describe('I10: PKT window boundaries', () => {
    // 2026-09-10T18:30Z = 23:30 PKT on the 10th; 19:30Z = 00:30 PKT on the 11th.
    const lateOn10 = expense('late-10', '2026-09-10T18:30:00Z', 100);
    const earlyOn11 = expense('early-11', '2026-09-10T19:30:00Z', 200);

    it('a 23:30 PKT entry is inside `to` = that day; 00:30 PKT next day is outside', async () => {
      const { svc } = makeReadService({ expenses: [lateOn10, earlyOn11] });

      const page = await svc.getTimeline(VENDOR_ID, { to: '2026-09-10', limit: 50 });
      expect(page.data.map((r) => r.sourceRecordId)).toEqual(['late-10']);

      const stats = await svc.getStats(VENDOR_ID, { to: '2026-09-10' });
      expect(stats.officeExpenses).toBe(100);
    });

    it('symmetrically for `from`: 00:30 PKT is inside `from` = that day, 23:30 PKT the day before is brought forward', async () => {
      const { svc } = makeReadService({ expenses: [lateOn10, earlyOn11] });

      const page = await svc.getTimeline(VENDOR_ID, { from: '2026-09-11', limit: 50 });

      expect(page.data.map((r) => r.sourceRecordId)).toEqual(['early-11']);
      expect(page.meta.broughtForward).toBe(-100);
      expect(page.data[0].runningBalance).toBe(-300);
    });

    it('a full ISO `to` is bucketed into its PKT day too', async () => {
      const { svc } = makeReadService({ expenses: [lateOn10, earlyOn11] });
      const page = await svc.getTimeline(VENDOR_ID, { to: '2026-09-10T20:00:00.000Z', limit: 50 }); // = 01:00 PKT on the 11th
      expect(page.data.map((r) => r.sourceRecordId).sort()).toEqual(['early-11', 'late-10']);
    });
  });

  describe('van-scoped view', () => {
    const t = '2026-09-10T06:00:00Z';
    const data: Data = {
      handovers: [handover('h-van', t, 1000), handover('h-other', t, 9999, { vanId: OTHER_VAN_ID })],
      manual: [
        manual('m-van', t, 300, { vanId: VAN_ID, van: { plateNumber: 'ABC-123' } }),
        manual('m-general', t, 7000), // general / office-wide
      ],
      expenses: [expense('e-van', t, 50, { vanId: VAN_ID }), expense('e-other', t, 60, { vanId: OTHER_VAN_ID })],
      remittances: [remittance('r', t, 500)],
      fuel: [fuelTopUp('f', t, 400)],
      crew: [crewCash('c', t, 100)],
      ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -800, t)],
      settlements: [settlement('s', SettlementMethod.CASH, 900, t)],
    };

    it('timeline excludes remittances / fuel / crew / payroll (advances + settlements) and other vans', async () => {
      const { svc, prisma } = makeReadService(data);

      const page = await svc.getTimeline(VENDOR_ID, { vanId: VAN_ID, limit: 50 });

      expect(page.data.map((r) => r.sourceRecordId).sort()).toEqual(['e-van', 'h-van', 'm-van']);
      // 1000 + 300 - 50
      expect(page.data[0].runningBalance).toBe(1250);
      // The vendor-wide sources were never even queried.
      expect(prisma.officeCashRemittance.findMany).not.toHaveBeenCalled();
      expect(prisma.fuelCardTopUp.findMany).not.toHaveBeenCalled();
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();
      expect(prisma.staffLedgerEntry.findMany).not.toHaveBeenCalled();
      expect(prisma.settlement.findMany).not.toHaveBeenCalled();
    });

    it('stats + availableBalance exclude the vendor-wide tiers and the general manual entry', async () => {
      const { svc, prisma } = makeReadService(data);

      const stats = await svc.getStats(VENDOR_ID, { vanId: VAN_ID });

      expect(stats).toMatchObject({
        sheetCashIn: 1000,
        officeCashIn: 300,
        officeExpenses: 50,
        payrollCash: 0,
        crewCash: 0,
        totalRemitted: 0,
        totalFuelCardTopUps: 0,
        totalCashIn: 1300,
        totalExpense: 50,
        availableBalance: 1250,
        pendingRemittanceCount: 0,
      });
      expect(prisma.officeCashRemittance.aggregate).not.toHaveBeenCalled();
      expect(prisma.fuelCardTopUp.aggregate).not.toHaveBeenCalled();
      expect(prisma.standaloneCrewCashExpense.aggregate).not.toHaveBeenCalled();
      expect(prisma.staffLedgerEntry.aggregate).not.toHaveBeenCalled();
      expect(prisma.settlement.aggregate).not.toHaveBeenCalled();
    });

    it('vendor-wide view includes all of them', async () => {
      const { svc } = makeReadService(data);
      const stats = await svc.getStats(VENDOR_ID, {});
      expect(stats.payrollCash).toBe(1700);
      expect(stats.crewCash).toBe(100);
      expect(stats.totalRemitted).toBe(500);
      expect(stats.totalFuelCardTopUps).toBe(400);
    });
  });

  describe('stats definitions', () => {
    const t = '2026-09-10T06:00:00Z';

    it('totalExpense = office + payroll + crew; transfers (owner, fuel) are NOT expenses; keeps every legacy key', async () => {
      const { svc } = makeReadService({
        handovers: [handover('h', t, 20000)],
        manual: [manual('m', t, 5000)],
        expenses: [expense('e', t, 1000)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -2000, t)],
        settlements: [settlement('s', SettlementMethod.CASH, 3000, t)],
        crew: [crewCash('c', t, 400), crewCash('c-void', t, 999, StandaloneCrewCashStatus.VOIDED)],
        remittances: [remittance('r', t, 6000), remittance('r-void', t, 999, OfficeCashRemittanceStatus.VOIDED)],
        fuel: [fuelTopUp('f', t, 700), fuelTopUp('f-void', t, 999, FuelCardTopUpStatus.VOIDED)],
      });

      const stats = await svc.getStats(VENDOR_ID, {});

      expect(stats).toEqual({
        totalExpense: 6400, // 1000 + (2000 + 3000) + 400
        totalCashIn: 25000, // 20000 sheet + 5000 office
        availableBalance: 25000 - 6400 - 6000 - 700,
        pendingHandoverCount: 0,
        totalRemitted: 6000,
        pendingRemittanceCount: 0,
        totalFuelCardTopUps: 700,
        totalStandaloneCrewCash: 400,
        sheetCashIn: 20000,
        officeCashIn: 5000,
        officeExpenses: 1000,
        payrollCash: 5000,
        crewCash: 400,
        broughtForward: 0,
        expectedClosing: 25000 - 6400 - 6000 - 700,
      });
    });

    it('sheet cash in uses the FINAL approved handover amount (an adjusted approval lands in `amount`)', async () => {
      const { svc } = makeReadService({
        handovers: [handover('h', t, 450, { expectedAmount: 500 }), handover('pending', t, 999, { status: VanCashHandoverStatus.PENDING })],
      });
      const stats = await svc.getStats(VENDOR_ID, {});
      expect(stats.sheetCashIn).toBe(450);
      expect(stats.pendingHandoverCount).toBe(1);
    });

    it('voided remittance / fuel / crew rows appear in the timeline as 0-amount audit rows', async () => {
      const { svc } = makeReadService({
        remittances: [remittance('r-void', t, 999, OfficeCashRemittanceStatus.VOIDED)],
        fuel: [fuelTopUp('f-void', t, 999, FuelCardTopUpStatus.VOIDED)],
        crew: [crewCash('c-void', t, 999, StandaloneCrewCashStatus.VOIDED)],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      expect(page.data).toHaveLength(3);
      for (const row of page.data) {
        expect(row.amount).toBe(0);
        expect(row.isVoided).toBe(true);
        expect(row.runningBalance).toBe(0);
      }
    });

    it('createRemittance/approveRemittance still see the live all-time balance (computeAvailableBalance)', async () => {
      const { svc } = makeReadService({
        handovers: [handover('h', '2026-01-01T00:00:00Z', 8000)],
        expenses: [expense('e', '2026-02-01T00:00:00Z', 1500)],
      });
      const balance = await (svc as any).computeAvailableBalance(VENDOR_ID);
      expect(balance).toBe(6500);
      expect(await (svc as any).computeAvailableBalance(VENDOR_ID, VAN_ID)).toBe(8000 - 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cash Ledger P1 — Row v2, dayStatements, summary, cash-breakdown
  // ═══════════════════════════════════════════════════════════════════════════

  const USER = { userId: 'user-1', vendorId: VENDOR_ID, name: 'Tester' } as any;

  describe('P1 row v2', () => {
    // date-only business day, stored at UTC midnight (= 05:00 PKT on the 10th).
    const businessDate = '2026-09-10T00:00:00Z';

    async function lagOf(createdAt: string): Promise<number> {
      const { svc } = makeReadService({ expenses: [expense('e', businessDate, 10, { createdAt: iso(createdAt) })] });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      return page.data[0].lagDays;
    }

    it('lagDays: 23:30 PKT on the business day is still same-day (0)', async () => {
      expect(await lagOf('2026-09-10T18:30:00Z')).toBe(0);
    });

    it('lagDays: 00:30 PKT the next day is 1 (a naive UTC diff would say 0)', async () => {
      expect(await lagOf('2026-09-10T19:30:00Z')).toBe(1);
    });

    it('lagDays: backdated by 3 PKT days (20:30Z on the 12th is 01:30 PKT on the 13th)', async () => {
      expect(await lagOf('2026-09-12T20:30:00Z')).toBe(3);
      expect(await lagOf('2026-09-13T06:00:00Z')).toBe(3);
    });

    it('lagDays: future-dated is -1 (recorded the PKT day BEFORE the business date)', async () => {
      expect(await lagOf('2026-09-09T06:00:00Z')).toBe(-1);
    });

    it('a handover closed days after its sheet date legitimately shows lag > 0', async () => {
      const { svc } = makeReadService({
        handovers: [handover('h', '2026-09-10T00:00:00Z', 100, { createdAt: iso('2026-09-12T06:00:00Z') })],
      });
      const page = await svc.getTimeline(VENDOR_ID, {});
      expect(page.data[0].lagDays).toBe(2);
    });

    it('direction: IN for sheet/office cash-in, OUT for expense/payroll/crew, TRANSFER for owner/fuel card', async () => {
      const t = '2026-09-10T06:00:00Z';
      const { svc } = makeReadService({
        handovers: [handover('h', t, 100)],
        manual: [manual('m', t, 100)],
        expenses: [expense('e', t, 10)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -10, t)],
        settlements: [settlement('s', SettlementMethod.CASH, 10, t)],
        remittances: [remittance('r', t, 10)],
        fuel: [fuelTopUp('f', t, 10)],
        crew: [crewCash('c', t, 10)],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const direction = Object.fromEntries(page.data.map((r) => [r.bucket, r.direction]));
      expect(direction).toEqual({
        SHEET_CASH_IN: 'IN',
        OFFICE_CASH_IN: 'IN',
        OFFICE_EXPENSE: 'OUT',
        PAYROLL_CASH: 'OUT',
        CREW_CASH: 'OUT',
        OWNER_TRANSFER: 'TRANSFER',
        FUEL_CARD: 'TRANSFER',
      });
    });

    it('isEdited: an Expense updated >60s after creation is edited; within the grace window / never updated is not', async () => {
      const created = '2026-09-10T06:00:00Z';
      const day = '2026-09-10T00:00:00Z';
      const { svc } = makeReadService({
        expenses: [
          expense('edited', day, 10, { createdAt: iso(created), updatedAt: iso('2026-09-10T06:01:01Z') }),
          expense('grace', day, 10, { createdAt: iso(created), updatedAt: iso('2026-09-10T06:00:30Z') }),
          expense('untouched', day, 10, { createdAt: iso(created), updatedAt: iso(created) }),
          expense('no-updatedAt', day, 10),
        ],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const byId = Object.fromEntries(page.data.map((r) => [r.sourceRecordId, r]));
      expect(byId.edited.isEdited).toBe(true);
      expect(byId.edited.lastEditedAt).toBe('2026-09-10T06:01:01.000Z');
      for (const id of ['grace', 'untouched', 'no-updatedAt']) {
        expect(byId[id].isEdited).toBe(false);
        expect(byId[id].lastEditedAt).toBeNull();
      }
    });

    it('isEdited is false for every non-Expense source in P1', async () => {
      const t = '2026-09-10T06:00:00Z';
      const later = iso('2026-09-20T00:00:00Z');
      const { svc } = makeReadService({
        handovers: [handover('h', t, 100, { updatedAt: later })],
        remittances: [remittance('r', t, 10, OfficeCashRemittanceStatus.APPROVED, { updatedAt: later })],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      for (const row of page.data) {
        expect(row.isEdited).toBe(false);
        expect(row.lastEditedAt).toBeNull();
      }
    });

    it('handover rows carry expectedAmount + variance; other rows carry null', async () => {
      const t = '2026-09-10T06:00:00Z';
      const { svc } = makeReadService({
        handovers: [handover('adj', t, 450, { expectedAmount: 500 }), handover('exact', t, 300)],
        expenses: [expense('e', t, 10)],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const byId = Object.fromEntries(page.data.map((r) => [r.sourceRecordId, r]));
      expect(byId.adj).toMatchObject({ expectedAmount: 500, variance: -50, amount: 450 });
      expect(byId.exact).toMatchObject({ expectedAmount: 300, variance: 0 });
      expect(byId.e).toMatchObject({ expectedAmount: null, variance: null });
    });

    it('fills recordedByName / notes / reference / hasAttachment / employeeId / voided* per source and never leaks the attachment key', async () => {
      const t = '2026-09-10T06:00:00Z';
      const { svc } = makeReadService({
        handovers: [handover('h', t, 100)],
        manual: [manual('m', t, 100, { note: 'Owner top-up', setBy: { name: 'Owner' } })],
        expenses: [expense('e', t, 10)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -10, t)],
        remittances: [
          remittance('r', t, 10, OfficeCashRemittanceStatus.APPROVED, {
            note: 'Deposited',
            reference: 'SLIP-9',
            attachmentKey: 'office-cash-remittance/secret-key.pdf',
          }),
        ],
        fuel: [
          fuelTopUp('f', t, 10, FuelCardTopUpStatus.VOIDED, {
            note: 'Typo',
            reference: 'F-1',
            attachmentKey: 'fuel/secret-key-2.png',
            voidedAt: iso('2026-09-11T06:00:00Z'),
            voidedBy: { name: 'Boss' },
          }),
        ],
        crew: [
          crewCash('c', t, 10, StandaloneCrewCashStatus.VOIDED, {
            notes: 'Tea money',
            employeeId: 'emp-7',
            voidedAt: iso('2026-09-12T06:00:00Z'),
            voidedBy: { name: 'Boss' },
          }),
        ],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const byId = Object.fromEntries(page.data.map((r) => [r.sourceRecordId, r]));

      expect(byId.h.recordedByName).toBe('Driver');
      expect(byId.m).toMatchObject({ recordedByName: 'Owner', notes: 'Owner top-up' });
      expect(byId.e.recordedByName).toBe('Accountant');
      expect(byId.e.notes).toBeNull();
      expect(byId.adv).toMatchObject({ recordedByName: 'Accountant', notes: 'ADVANCE adv' });
      expect(byId.r).toMatchObject({
        recordedByName: 'Accountant',
        notes: 'Deposited',
        reference: 'SLIP-9',
        hasAttachment: true,
        voidedAt: null,
        voidedByName: null,
      });
      expect(byId.f).toMatchObject({
        recordedByName: 'Accountant',
        notes: 'Typo',
        reference: 'F-1',
        hasAttachment: true,
        voidedAt: '2026-09-11T06:00:00.000Z',
        voidedByName: 'Boss',
      });
      expect(byId.c).toMatchObject({
        recordedByName: 'Accountant',
        notes: 'Tea money',
        employeeId: 'emp-7',
        voidedAt: '2026-09-12T06:00:00.000Z',
        voidedByName: 'Boss',
      });
      expect(JSON.stringify(page.data)).not.toContain('secret-key');
    });

    it('settlement rows report paidBy as the recorder and the employee id', async () => {
      const { svc } = makeReadService({
        settlements: [
          {
            ...settlement('s', SettlementMethod.CASH, 100, '2026-09-10T06:00:00Z'),
            payrollEntry: { user: { id: 'emp-3', name: 'Bilal' } },
          },
        ],
      });
      const page = await svc.getTimeline(VENDOR_ID, {});
      expect(page.data[0]).toMatchObject({ recordedByName: 'Accountant', employeeId: 'emp-3' });
    });

    describe('canVoid', () => {
      const t = '2026-09-10T06:00:00Z';
      const data: Data = {
        crew: [crewCash('c-live', t, 10), crewCash('c-void', t, 10, StandaloneCrewCashStatus.VOIDED)],
        fuel: [fuelTopUp('f-live', t, 10), fuelTopUp('f-void', t, 10, FuelCardTopUpStatus.VOIDED)],
        remittances: [remittance('r', t, 10)],
        expenses: [expense('e', t, 10)],
      };
      const byId = (rows: Array<{ sourceRecordId: string; canVoid: boolean }>) =>
        Object.fromEntries(rows.map((r) => [r.sourceRecordId, r.canVoid]));

      it('crew_cash:delete only: only the live crew-cash row is voidable', async () => {
        const { svc } = makeReadService(data, (_u, p) => p === 'crew_cash:delete');
        const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER);
        expect(byId(page.data)).toEqual({
          'c-live': true,
          'c-void': false,
          'f-live': false,
          'f-void': false,
          r: false,
          e: false,
        });
      });

      it('fuel_cards:topup_void only: only the live fuel top-up is voidable', async () => {
        const { svc } = makeReadService(data, (_u, p) => p === 'fuel_cards:topup_void');
        const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER);
        expect(byId(page.data)).toMatchObject({ 'c-live': false, 'f-live': true, 'f-void': false, 'c-void': false });
      });

      it('resolves each permission at most once per request, for the calling user', async () => {
        const { svc, permissions } = makeReadService(
          { crew: [crewCash('c1', t, 1), crewCash('c2', t, 1)], fuel: [fuelTopUp('f1', t, 1), fuelTopUp('f2', t, 1)] },
          () => true,
        );
        await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER);
        expect(permissions.can).toHaveBeenCalledTimes(3);
        expect(permissions.can).toHaveBeenCalledWith('user-1', 'crew_cash:delete');
        expect(permissions.can).toHaveBeenCalledWith('user-1', 'crew_cash:edit');
        expect(permissions.can).toHaveBeenCalledWith('user-1', 'fuel_cards:topup_void');
      });

      it('no user (analytics / internal callers): canVoid is false everywhere and permissions are never consulted', async () => {
        const { svc, permissions } = makeReadService(data, () => true);
        const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
        expect(page.data.every((r) => r.canVoid === false)).toBe(true);
        expect(permissions.can).not.toHaveBeenCalled();
      });
    });
  });

  describe('P1 meta.dayStatements', () => {
    // 10th: h1 +1000, e1 -300 (recorded 3 days late) | 11th: m1 +500, r1 -200 | 12th: f1 -100
    const data: Data = {
      handovers: [handover('h1', '2026-09-10T06:00:00Z', 1000)],
      expenses: [expense('e1', '2026-09-10T07:00:00Z', 300, { createdAt: iso('2026-09-13T06:00:00Z') })],
      manual: [manual('m1', '2026-09-11T06:00:00Z', 500)],
      remittances: [remittance('r1', '2026-09-11T07:00:00Z', 200)],
      fuel: [fuelTopUp('f1', '2026-09-12T06:00:00Z', 100)],
    };

    it('keys only the days on the returned page, but each day statement covers the WHOLE day (page size 2)', async () => {
      const { svc } = makeReadService(data);

      // newest-first order: f1, r1 | m1, e1 | h1
      const p1 = await svc.getTimeline(VENDOR_ID, { page: 1, limit: 2 });
      expect(p1.data.map((r) => r.sourceRecordId)).toEqual(['f1', 'r1']);
      expect(Object.keys(p1.meta.dayStatements).sort()).toEqual(['2026-09-11', '2026-09-12']);
      // 11th is split across pages 1/2, yet its statement already includes m1.
      expect(p1.meta.dayStatements['2026-09-11']).toEqual({
        date: '2026-09-11',
        opening: 700,
        sheetCashIn: 0,
        officeCashIn: 500,
        totalCashIn: 500,
        officeExpenses: 0,
        payrollCash: 0,
        crewCash: 0,
        totalExpenses: 0,
        ownerTransfer: 200,
        fuelCard: 0,
        net: 300,
        closing: 1000,
        entryCount: 2,
        lateCount: 0,
      });

      const p2 = await svc.getTimeline(VENDOR_ID, { page: 2, limit: 2 });
      expect(p2.data.map((r) => r.sourceRecordId)).toEqual(['m1', 'e1']);
      expect(Object.keys(p2.meta.dayStatements).sort()).toEqual(['2026-09-10', '2026-09-11']);
      expect(p2.meta.dayStatements['2026-09-11']).toEqual(p1.meta.dayStatements['2026-09-11']);

      const p3 = await svc.getTimeline(VENDOR_ID, { page: 3, limit: 2 });
      expect(Object.keys(p3.meta.dayStatements)).toEqual(['2026-09-10']);
    });

    it('opening/closing chain across days; lateCount counts lagDays > 0', async () => {
      const { svc } = makeReadService(data);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const days = page.meta.dayStatements;

      expect(Object.keys(days).sort()).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
      expect(days['2026-09-10']).toMatchObject({
        opening: 0,
        sheetCashIn: 1000,
        officeExpenses: 300,
        totalExpenses: 300,
        net: 700,
        closing: 700,
        entryCount: 2,
        lateCount: 1, // e1 was recorded on the 13th for the 10th
      });
      expect(days['2026-09-11'].opening).toBe(days['2026-09-10'].closing);
      expect(days['2026-09-12']).toMatchObject({ opening: 1000, fuelCard: 100, net: -100, closing: 900, totalExpenses: 0 });
      expect(days['2026-09-12'].opening).toBe(days['2026-09-11'].closing);
      // last day's closing == the newest row's running balance
      expect(days['2026-09-12'].closing).toBe(page.data[0].runningBalance);
    });

    it('the first day of a `from` window opens at broughtForward', async () => {
      const { svc } = makeReadService(data);
      const page = await svc.getTimeline(VENDOR_ID, { from: '2026-09-11', limit: 50 });
      expect(page.meta.broughtForward).toBe(700);
      expect(page.meta.dayStatements['2026-09-11'].opening).toBe(700);
      expect(page.meta.dayStatements['2026-09-10']).toBeUndefined();
    });

    it('voided rows count toward entryCount but not the totals', async () => {
      const { svc } = makeReadService({
        crew: [crewCash('c-void', '2026-09-10T06:00:00Z', 999, StandaloneCrewCashStatus.VOIDED)],
        manual: [manual('m', '2026-09-10T05:00:00Z', 100)],
      });
      const page = await svc.getTimeline(VENDOR_ID, {});
      expect(page.meta.dayStatements['2026-09-10']).toMatchObject({ entryCount: 2, crewCash: 0, net: 100, closing: 100 });
    });

    it('an empty window yields an empty dayStatements map', async () => {
      const { svc } = makeReadService({});
      const page = await svc.getTimeline(VENDOR_ID, {});
      expect(page.meta.dayStatements).toEqual({});
    });
  });

  describe('P1 GET summary', () => {
    const Q = { from: '2026-09-01', to: '2026-09-30' };

    it('statement.expectedClosing equals the live availableBalance for a window that runs to the latest row', async () => {
      const { svc } = makeReadService({
        manual: [manual('m-old', '2026-08-01T00:00:00Z', 10000)],
        handovers: [handover('h-old', '2026-08-05T00:00:00Z', 5000), handover('h-in', '2026-09-02T00:00:00Z', 3000)],
        expenses: [expense('e-old', '2026-08-10T06:00:00Z', 2000), expense('e-in', '2026-09-03T06:00:00Z', 500)],
        remittances: [remittance('r1', '2026-09-04T06:00:00Z', 1000)],
        fuel: [fuelTopUp('f1', '2026-09-04T07:00:00Z', 200)],
        crew: [crewCash('c1', '2026-09-04T08:00:00Z', 100)],
        ledger: [ledgerEntry('adv', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -700, '2026-09-04T09:00:00Z')],
        settlements: [settlement('s1', SettlementMethod.CASH, 1300, '2026-09-04T10:00:00Z')],
      });

      const summary = await svc.getSummary(VENDOR_ID, Q);
      const stats = await svc.getStats(VENDOR_ID, Q);

      expect(summary.scope).toBe('OFFICE');
      expect(summary.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
      expect(summary.statement.broughtForward).toBe(13000);
      expect(summary.statement.expectedClosing).toBe(12200);
      expect(summary.availableBalance).toBe(12200);
      expect(summary.statement.expectedClosing).toBe(summary.availableBalance);
      // the row-fold statement agrees with the aggregate stats
      expect(summary.statement).toMatchObject({
        sheetCashIn: stats.sheetCashIn,
        officeCashIn: stats.officeCashIn,
        officeExpenses: stats.officeExpenses,
        payrollCash: stats.payrollCash,
        crewCash: stats.crewCash,
        ownerTransfer: stats.totalRemitted,
        fuelCard: stats.totalFuelCardTopUps,
        totalCashIn: stats.totalCashIn,
        totalExpenses: stats.totalExpense,
      });
      expect(summary.statement.net).toBe(summary.statement.expectedClosing - summary.statement.broughtForward);
    });

    it('no window: range is null/null, brought-forward 0', async () => {
      const { svc } = makeReadService({ manual: [manual('m', '2026-09-10T00:00:00Z', 100)] });
      const summary = await svc.getSummary(VENDOR_ID, {});
      expect(summary.range).toEqual({ from: null, to: null });
      expect(summary.statement.broughtForward).toBe(0);
      expect(summary.statement.expectedClosing).toBe(100);
    });

    it('a full-ISO window is echoed as its PKT day', async () => {
      const { svc } = makeReadService({});
      const summary = await svc.getSummary(VENDOR_ID, { from: '2026-09-09T19:30:00Z', to: '2026-09-10T18:30:00Z' });
      expect(summary.range).toEqual({ from: '2026-09-10', to: '2026-09-10' });
    });

    describe('memo pending tiers + van scope', () => {
      const t = '2026-09-10T06:00:00Z';
      const data: Data = {
        handovers: [
          handover('h-ok', t, 1000),
          handover('p1', t, 100, { status: VanCashHandoverStatus.PENDING }),
          handover('p2', t, 250, { status: VanCashHandoverStatus.PENDING }),
          handover('p-other', t, 999, { status: VanCashHandoverStatus.PENDING, vanId: OTHER_VAN_ID }),
        ],
        remittances: [remittance('r-pending', t, 700, OfficeCashRemittanceStatus.PENDING), remittance('r-ok', t, 50)],
        ledger: [
          ledgerEntry('adv-p', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.PENDING, -400, t),
          ledgerEntry('adv-p2', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.PENDING, -100, t),
          ledgerEntry('adv-posted', StaffLedgerCategory.ADVANCE, LedgerEntryStatus.POSTED, -900, t),
          ledgerEntry('bonus-p', StaffLedgerCategory.BONUS, LedgerEntryStatus.PENDING, -50, t),
        ],
      };

      it('vendor scope: pending handovers (all vans), remittances and advances', async () => {
        const { svc } = makeReadService(data);
        const summary = await svc.getSummary(VENDOR_ID, {});
        expect(summary.memo.pendingHandovers).toEqual({ count: 3, amount: 1349 });
        expect(summary.memo.pendingRemittances).toEqual({ count: 1, amount: 700 });
        expect(summary.memo.pendingAdvances).toEqual({ count: 2, amount: 500 });
      });

      it("van scope: only that van's pending handovers; vendor-wide tiers are 0 and never queried", async () => {
        const { svc, prisma } = makeReadService(data);

        const summary = await svc.getSummary(VENDOR_ID, { vanId: VAN_ID });

        expect(summary.scope).toBe('VAN');
        expect(summary.memo.pendingHandovers).toEqual({ count: 2, amount: 350 });
        expect(summary.memo.pendingRemittances).toEqual({ count: 0, amount: 0 });
        expect(summary.memo.pendingAdvances).toEqual({ count: 0, amount: 0 });
        expect(summary.statement).toMatchObject({
          ownerTransfer: 0,
          fuelCard: 0,
          crewCash: 0,
          payrollCash: 0,
          sheetCashIn: 1000,
        });
        expect(prisma.officeCashRemittance.aggregate).not.toHaveBeenCalled();
        expect(prisma.staffLedgerEntry.aggregate).not.toHaveBeenCalled();
        expect(prisma.officeCashRemittance.findMany).not.toHaveBeenCalled();
        expect(prisma.fuelCardTopUp.findMany).not.toHaveBeenCalled();
      });

      it('pending handovers are NOT date-scoped', async () => {
        const { svc } = makeReadService(data);
        const summary = await svc.getSummary(VENDOR_ID, { from: '2026-12-01', to: '2026-12-31' });
        expect(summary.memo.pendingHandovers.count).toBe(3);
      });
    });

    describe('trend + firstNegativeDate', () => {
      it('closing series for days with activity, and the first day that closes negative', async () => {
        const { svc } = makeReadService({
          expenses: [expense('e', '2026-09-10T06:00:00Z', 500)],
          handovers: [handover('h', '2026-09-12T06:00:00Z', 2000)],
          fuel: [fuelTopUp('f', '2026-09-12T07:00:00Z', 100)],
        });
        const summary = await svc.getSummary(VENDOR_ID, {});
        // the 11th has no activity, so no point on the trend.
        expect(summary.trend).toEqual([
          { date: '2026-09-10', closing: -500 },
          { date: '2026-09-12', closing: 1400 },
        ]);
        expect(summary.memo.firstNegativeDate).toBe('2026-09-10');
      });

      it('null when no day closes negative', async () => {
        const { svc } = makeReadService({ manual: [manual('m', '2026-09-10T06:00:00Z', 100)] });
        const summary = await svc.getSummary(VENDOR_ID, {});
        expect(summary.memo.firstNegativeDate).toBeNull();
        expect(summary.trend).toEqual([{ date: '2026-09-10', closing: 100 }]);
      });

      it('a `from` window starts the series from broughtForward', async () => {
        const { svc } = makeReadService({
          manual: [manual('m', '2026-08-10T06:00:00Z', 1000)],
          expenses: [expense('e', '2026-09-10T06:00:00Z', 1500)],
        });
        const summary = await svc.getSummary(VENDOR_ID, { from: '2026-09-01' });
        expect(summary.trend).toEqual([{ date: '2026-09-10', closing: -500 }]);
        expect(summary.memo.firstNegativeDate).toBe('2026-09-10');
      });
    });

    describe('sheetBreakdown + approvalAdjustments', () => {
      // Sheet A: collected 8,000 - expenses 1,500 - crew 400 = 6,100 (approved as-is)
      // Sheet B: collected 7,600 - expenses 1,400 - crew 300 = 5,900 (approved at 5,800: variance -100)
      // Sum: collected 15,600 / expenses 2,900 / crew 700 / net 12,000
      const sheetData = (): Data => ({
        handovers: [
          handover('A', '2026-09-10T00:00:00Z', 6100, { dailySheetId: 'sheet-A' }),
          handover('B', '2026-09-11T00:00:00Z', 5800, {
            dailySheetId: 'sheet-B',
            expectedAmount: 5900,
            adjustmentReason: 'Short count',
          }),
        ],
        sheets: [
          { id: 'sheet-A', vendorId: VENDOR_ID, date: iso('2026-09-10T00:00:00Z'), cashCollected: 8000 },
          { id: 'sheet-B', vendorId: VENDOR_ID, date: iso('2026-09-11T00:00:00Z'), cashCollected: 7600 },
          { id: 'sheet-out', vendorId: VENDOR_ID, date: iso('2026-08-01T00:00:00Z'), cashCollected: 99999 },
        ],
        expenses: [
          expense('ea1', '2026-09-10T00:00:00Z', 1000, { dailySheetId: 'sheet-A' }),
          expense('ea2', '2026-09-10T00:00:00Z', 500, { dailySheetId: 'sheet-A' }),
          expense('eb1', '2026-09-11T00:00:00Z', 1400, { dailySheetId: 'sheet-B' }),
          // card-paid: never left the van cash
          expense('ea-card', '2026-09-10T00:00:00Z', 777, { dailySheetId: 'sheet-A', paidFromCash: false }),
          // a sheet outside the window
          expense('eo', '2026-08-01T00:00:00Z', 555, { dailySheetId: 'sheet-out' }),
        ],
        crewDist: [
          { id: 'ca', vendorId: VENDOR_ID, dailySheetId: 'sheet-A', amount: 400 },
          { id: 'cb', vendorId: VENDOR_ID, dailySheetId: 'sheet-B', amount: 300 },
          { id: 'co', vendorId: VENDOR_ID, dailySheetId: 'sheet-out', amount: 111 },
        ],
      });

      it('aggregates collected / expenses / crew cash / net over the approved sheets and balances (other = 0)', async () => {
        const { svc, prisma } = makeReadService(sheetData());
        const summary = await svc.getSummary(VENDOR_ID, Q);

        expect(summary.memo.sheetBreakdown).toEqual({
          sheets: 2,
          collected: 15600,
          expenses: 2900,
          crewCash: 700,
          net: 12000,
          other: 0,
        });
        expect(summary.memo.approvalAdjustments).toBe(-100);
        // Fixed query count: grouped aggregates, never a loop per sheet.
        expect(prisma.dailySheet.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.expense.groupBy).toHaveBeenCalledTimes(1);
        expect(prisma.crewCashDistribution.groupBy).toHaveBeenCalledTimes(1);
      });

      it('per-sheet net is floored at 0 (an over-spent sheet never contributes a negative)', async () => {
        const data = sheetData();
        data.crewDist!.push({ id: 'cb2', vendorId: VENDOR_ID, dailySheetId: 'sheet-B', amount: 9000 });
        const { svc } = makeReadService(data);
        const summary = await svc.getSummary(VENDOR_ID, Q);
        // sheet B: 7600 - 1400 - 9300 < 0, so 0; net = 6100 only
        expect(summary.memo.sheetBreakdown.net).toBe(6100);
        expect(summary.memo.sheetBreakdown.crewCash).toBe(9700);
        // expected (6100 + 5900) - 6100
        expect(summary.memo.sheetBreakdown.other).toBe(5900);
      });

      it('corrections count in `other` (expected) but not in the sheet count; voided rows are excluded', async () => {
        const data = sheetData();
        data.handovers!.push(
          handover('B-corr', '2026-09-11T00:00:00Z', 250, { dailySheetId: 'sheet-B', correctsEntryId: 'B' }),
          handover('B-void', '2026-09-11T00:00:00Z', 999, { dailySheetId: 'sheet-B', status: VanCashHandoverStatus.VOIDED }),
        );
        const { svc } = makeReadService(data);
        const summary = await svc.getSummary(VENDOR_ID, Q);

        expect(summary.memo.sheetBreakdown.sheets).toBe(2);
        expect(summary.memo.sheetBreakdown.net).toBe(12000);
        expect(summary.memo.sheetBreakdown.other).toBe(250);
        expect(summary.memo.approvalAdjustments).toBe(-100); // a correction row has amount == expectedAmount
      });

      it('only handovers dated in the window contribute; van scope narrows to that van', async () => {
        const { svc } = makeReadService(sheetData());
        const onlyA = await svc.getSummary(VENDOR_ID, { from: '2026-09-10', to: '2026-09-10' });
        expect(onlyA.memo.sheetBreakdown).toMatchObject({ sheets: 1, collected: 8000, expenses: 1500, crewCash: 400, net: 6100, other: 0 });
        expect(onlyA.memo.approvalAdjustments).toBe(0);

        const { svc: svc2 } = makeReadService(sheetData());
        const otherVan = await svc2.getSummary(VENDOR_ID, { vanId: OTHER_VAN_ID });
        expect(otherVan.memo.sheetBreakdown).toEqual({ sheets: 0, collected: 0, expenses: 0, crewCash: 0, net: 0, other: 0 });
      });

      it('no approved handovers: zeros and no sheet queries', async () => {
        const { svc, prisma } = makeReadService({});
        const summary = await svc.getSummary(VENDOR_ID, Q);
        expect(summary.memo.sheetBreakdown).toEqual({ sheets: 0, collected: 0, expenses: 0, crewCash: 0, net: 0, other: 0 });
        expect(prisma.dailySheet.findMany).not.toHaveBeenCalled();
        expect(prisma.expense.groupBy).not.toHaveBeenCalled();
      });
    });
  });

  describe('P1 GET sheets/:sheetId/cash-breakdown', () => {
    const sheetId = 'sheet-A';
    const base = (): Data => ({
      sheets: [
        { id: sheetId, vendorId: VENDOR_ID, date: iso('2026-09-10T00:00:00Z'), cashCollected: 8000 },
        { id: 'sheet-nohandover', vendorId: VENDOR_ID, date: iso('2026-09-10T00:00:00Z'), cashCollected: 10 },
        { id: 'sheet-foreign', vendorId: 'vendor-999', date: iso('2026-09-10T00:00:00Z'), cashCollected: 10 },
      ],
      handovers: [
        handover('orig', '2026-09-10T00:00:00Z', 6000, {
          dailySheetId: sheetId,
          expectedAmount: 6100,
          adjustmentReason: 'Short count',
          approvedBy: { name: 'Admin' },
        }),
        handover('corr', '2026-09-10T00:00:00Z', 250, {
          dailySheetId: sheetId,
          correctsEntryId: 'orig',
          approvedBy: null,
        }),
        handover('void', '2026-09-10T00:00:00Z', 999, { dailySheetId: sheetId, status: VanCashHandoverStatus.VOIDED }),
        // belongs to the foreign vendor's sheet
        handover('foreign', '2026-09-10T00:00:00Z', 10, { dailySheetId: 'sheet-foreign', vendorId: 'vendor-999' }),
      ],
      expenses: [
        expense('e1', '2026-09-10T00:00:00Z', 1000, { dailySheetId: sheetId }),
        expense('e2', '2026-09-10T00:00:00Z', 500, { dailySheetId: sheetId }),
        expense('e-card', '2026-09-10T00:00:00Z', 200, { dailySheetId: sheetId, paidFromCash: false }),
      ],
      crewDist: [{ id: 'c1', vendorId: VENDOR_ID, dailySheetId: sheetId, amount: 400 }],
    });

    it('happy path: chain totals across the non-voided rows, adjustment + approver from the original', async () => {
      const { svc } = makeReadService(base());
      const result = await svc.getSheetCashBreakdown(VENDOR_ID, sheetId);

      expect(result).toEqual({
        dailySheetId: sheetId,
        sheetShortId: 'SHEET-A',
        sheetDate: '2026-09-10T00:00:00.000Z',
        collected: 8000,
        expenses: 1500,
        crewCash: 400,
        netFromSheet: 6100,
        expected: 6350, // 6100 + 250 (voided 999 excluded)
        approved: 6250, // 6000 + 250
        variance: -100,
        other: 250, // 6350 - 6100
        adjustmentReason: 'Short count',
        approvedByName: 'Admin',
      });
    });

    it('a sheet that balances has other = 0 and variance = 0', async () => {
      const data = base();
      data.handovers = [handover('orig', '2026-09-10T00:00:00Z', 6100, { dailySheetId: sheetId })];
      const { svc } = makeReadService(data);
      const result = await svc.getSheetCashBreakdown(VENDOR_ID, sheetId);
      expect(result).toMatchObject({ other: 0, variance: 0, expected: 6100, approved: 6100, adjustmentReason: null });
    });

    it('netFromSheet floors at 0', async () => {
      const data = base();
      data.crewDist = [{ id: 'c1', vendorId: VENDOR_ID, dailySheetId: sheetId, amount: 20000 }];
      const { svc } = makeReadService(data);
      const result = await svc.getSheetCashBreakdown(VENDOR_ID, sheetId);
      expect(result.netFromSheet).toBe(0);
      expect(result.other).toBe(6350);
    });

    it('404 when the sheet does not exist, belongs to another vendor, or has no handover', async () => {
      const { svc } = makeReadService(base());
      await expect(svc.getSheetCashBreakdown(VENDOR_ID, 'nope')).rejects.toThrow(NotFoundException);
      await expect(svc.getSheetCashBreakdown(VENDOR_ID, 'sheet-foreign')).rejects.toThrow(NotFoundException);
      await expect(svc.getSheetCashBreakdown(VENDOR_ID, 'sheet-nohandover')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Cash Ledger P2 — manual cash-in edit/void reads, edit flags, history ───

  describe('P2 manual cash-in (edit / void) in the reads', () => {
    const USER_P2 = { userId: 'user-1', vendorId: VENDOR_ID, name: 'Tester' } as any;

    it('a VOIDED manual entry is shown (amount 0, struck-through fields) but excluded from every aggregate', async () => {
      const { svc } = makeReadService({
        manual: [
          manual('m-live', '2026-09-05T00:00:00Z', 5000),
          manual('m-void', '2026-09-06T00:00:00Z', 900, {
            status: ManualCashInStatus.VOIDED,
            voidReason: 'Entered twice',
            voidedAt: iso('2026-09-07T06:00:00Z'),
            voidedBy: { name: 'Boss' },
            version: 2,
          }),
        ],
        expenses: [expense('e', '2026-09-08T06:00:00Z', 1000)],
      });

      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const voided = page.data.find((r) => r.sourceRecordId === 'm-void');
      expect(voided).toMatchObject({
        amount: 0,
        displayAmount: 900,
        isVoided: true,
        voidReason: 'Entered twice',
        voidedAt: '2026-09-07T06:00:00.000Z',
        voidedByName: 'Boss',
        canVoid: false,
        canEdit: false,
      });
      // The running balance is unaffected by the voided row: 5000 (m-live) -1000 (expense).
      expect(page.data[0].runningBalance).toBe(4000);

      const stats = await svc.getStats(VENDOR_ID, {});
      expect(stats.officeCashIn).toBe(5000);
      expect(stats.availableBalance).toBe(4000);
      const summary = await svc.getSummary(VENDOR_ID, {});
      expect(summary.statement.officeCashIn).toBe(5000);
      expect(summary.availableBalance).toBe(4000);
    });

    it('a VOIDED manual entry is excluded from brought-forward too', async () => {
      const { svc } = makeReadService({
        manual: [
          manual('m-live', '2026-08-05T00:00:00Z', 5000),
          manual('m-void', '2026-08-06T00:00:00Z', 900, { status: ManualCashInStatus.VOIDED }),
        ],
        expenses: [expense('e', '2026-09-08T06:00:00Z', 1000)],
      });
      const page = await svc.getTimeline(VENDOR_ID, { from: '2026-09-01', limit: 50 });
      expect(page.meta.broughtForward).toBe(5000);
      expect(page.data[0].runningBalance).toBe(4000);
    });

    it('row fields: version, source, isEdited / lastEditedAt, and sourceBadge (source label when set)', async () => {
      const { svc } = makeReadService({
        manual: [
          manual('m-src', '2026-09-05T00:00:00Z', 100, {
            source: 'OWNER_INJECTION',
            version: 3,
            editCount: 2,
            lastEditedAt: iso('2026-09-06T08:00:00Z'),
            vanId: 'van-1',
            van: { plateNumber: 'ABC-1' },
          }),
          manual('m-plain', '2026-09-04T00:00:00Z', 100),
          manual('m-van', '2026-09-03T00:00:00Z', 100, { vanId: 'van-1', van: { plateNumber: 'ABC-1' } }),
        ],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const byId = Object.fromEntries(page.data.map((r) => [r.sourceRecordId, r]));
      expect(byId['m-src']).toMatchObject({
        version: 3,
        source: 'OWNER_INJECTION',
        isEdited: true,
        lastEditedAt: '2026-09-06T08:00:00.000Z',
        sourceBadge: 'Owner added cash',
        isVoided: false,
      });
      expect(byId['m-plain']).toMatchObject({
        version: 1,
        source: null,
        isEdited: false,
        lastEditedAt: null,
        sourceBadge: 'Manual Cash In',
      });
      expect(byId['m-van'].sourceBadge).toBe('Opening Balance');
    });

    it('canEdit / canVoid on a manual entry need van_cash_ledger:manage and an ACTIVE row', async () => {
      const data: Data = {
        manual: [
          manual('m-live', '2026-09-05T00:00:00Z', 100),
          manual('m-void', '2026-09-05T00:00:00Z', 100, { status: ManualCashInStatus.VOIDED }),
        ],
      };
      const flags = (rows: any[]) =>
        Object.fromEntries(rows.map((r) => [r.sourceRecordId, [r.canEdit, r.canVoid, r.editBlockedReason]]));

      const withManage = makeReadService(data, (_u, p) => p === 'van_cash_ledger:manage');
      expect(flags((await withManage.svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P2)).data)).toEqual({
        'm-live': [true, true, null],
        'm-void': [false, false, null],
      });

      const without = makeReadService(data, () => false);
      expect(flags((await without.svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P2)).data)).toEqual({
        'm-live': [false, false, null],
        'm-void': [false, false, null],
      });
    });
  });

  describe('P2 standalone crew cash canEdit / editBlockedReason', () => {
    const t = '2026-09-10T06:00:00Z';
    const USER_P2 = { userId: 'user-1', vendorId: VENDOR_ID, name: 'Tester' } as any;
    const twin = (payrollEntryId: string | null) => ({ payrollEntryId, status: LedgerEntryStatus.POSTED });
    const data: Data = {
      crew: [
        crewCash('c-open', t, 10, StandaloneCrewCashStatus.ACTIVE, { staffLedgerEntry: twin(null) }),
        crewCash('c-locked', t, 10, StandaloneCrewCashStatus.ACTIVE, { staffLedgerEntry: twin('payroll-1') }),
        crewCash('c-void', t, 10, StandaloneCrewCashStatus.VOIDED, { staffLedgerEntry: twin('payroll-1') }),
      ],
    };
    const flags = (rows: any[]) =>
      Object.fromEntries(rows.map((r) => [r.sourceRecordId, [r.canEdit, r.editBlockedReason]]));

    it('crew_cash:edit: unlocked twin -> editable; locked twin -> blocked WITH the reason; voided -> neither', async () => {
      const { svc } = makeReadService(data, (_u, p) => p === 'crew_cash:edit');
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P2);
      expect(flags(page.data)).toEqual({
        'c-open': [true, null],
        'c-locked': [false, STANDALONE_CREW_CASH_LOCKED_REASON],
        'c-void': [false, null],
      });
    });

    it('without crew_cash:edit the reason is NOT leaked (nothing to explain)', async () => {
      const { svc } = makeReadService(data, (_u, p) => p === 'crew_cash:delete');
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P2);
      expect(flags(page.data)).toEqual({
        'c-open': [false, null],
        'c-locked': [false, null],
        'c-void': [false, null],
      });
      // ...but delete still works independently of edit.
      expect(page.data.find((r) => r.sourceRecordId === 'c-locked')?.canVoid).toBe(true);
    });

    it('no user: never editable, no reason, permissions never consulted', async () => {
      const { svc, permissions } = makeReadService(data, () => true);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      expect(flags(page.data)).toEqual({
        'c-open': [false, null],
        'c-locked': [false, null],
        'c-void': [false, null],
      });
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('row fields: version, isEdited / lastEditedAt, employeeId; the twin itself is not leaked', async () => {
      const { svc } = makeReadService({
        crew: [
          crewCash('c-edited', t, 10, StandaloneCrewCashStatus.ACTIVE, {
            version: 4,
            editCount: 3,
            lastEditedAt: iso('2026-09-11T06:00:00Z'),
            employeeId: 'emp-9',
            staffLedgerEntry: twin(null),
          }),
          crewCash('c-fresh', t, 10, StandaloneCrewCashStatus.ACTIVE, { version: 1, editCount: 0 }),
        ],
      });
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const byId = Object.fromEntries(page.data.map((r) => [r.sourceRecordId, r]));
      expect(byId['c-edited']).toMatchObject({
        version: 4,
        isEdited: true,
        lastEditedAt: '2026-09-11T06:00:00.000Z',
        employeeId: 'emp-9',
      });
      expect(byId['c-fresh']).toMatchObject({ version: 1, isEdited: false, lastEditedAt: null });
      expect(JSON.stringify(page.data)).not.toContain('payrollEntryId');
    });

    it('the timeline asks for the payroll twin (payrollEntryId + status) alongside the crew-cash rows', async () => {
      const { svc, prisma } = makeReadService(data);
      await svc.getTimeline(VENDOR_ID, { limit: 50 });
      expect(prisma.standaloneCrewCashExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            staffLedgerEntry: { select: { payrollEntryId: true, status: true } },
          }),
        }),
      );
    });
  });

  describe('P2 GET entries/:sourceType/:sourceRecordId/history', () => {
    const OTHER_VENDOR = 'vendor-999';

    function auditRow(
      id: string,
      entity: string,
      entityId: string,
      action: string,
      at: string,
      changes: unknown,
      over: Record<string, unknown> = {},
    ) {
      return {
        id,
        vendorId: VENDOR_ID,
        userId: 'user-1',
        userName: 'Admin',
        action,
        entity,
        entityId,
        changes,
        createdAt: iso(at),
        ...over,
      };
    }

    it('manual cash-in: CREATED + UPDATED audit rows -> both events, newest first, with diff + reason', async () => {
      const { svc } = makeReadService({
        manual: [
          manual('m1', '2026-09-09T00:00:00Z', 12000, {
            note: 'Top-up',
            vanId: 'van-9',
            editCount: 1,
            setBy: { name: 'Owner' },
          }),
        ],
        vans: [{ id: 'van-9', vendorId: VENDOR_ID, plateNumber: 'LEA-9' }],
        audit: [
          auditRow('a1', 'VanCashOpeningBalance', 'm1', 'CREATED', '2026-09-10T06:00:00Z', {
            after: {
              vanId: null,
              openingBalance: 10000,
              openingDate: '2026-09-10T00:00:00.000Z',
              note: 'Top-up',
              source: null,
            },
          }),
          auditRow(
            'a2',
            'VanCashOpeningBalance',
            'm1',
            'UPDATED',
            '2026-09-11T06:00:00Z',
            {
              before: { openingBalance: 10000, vanId: null, openingDate: '2026-09-10T00:00:00.000Z', source: null },
              after: {
                openingBalance: 12000,
                vanId: 'van-9',
                openingDate: '2026-09-09T00:00:00.000Z',
                source: 'REFUND',
              },
              reason: 'Wrong amount entered',
            },
            { userName: 'Boss' },
          ),
        ],
      });

      const history = await svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm1');

      expect(history.entry).toMatchObject({
        sourceType: 'OPENING_BALANCE',
        sourceRecordId: 'm1',
        title: 'Top-up',
        amount: 12000,
        recordedByName: 'Owner',
        status: 'ACTIVE',
        isVoided: false,
      });
      // No synthesised event: a CREATED audit row already exists.
      expect(history.events.map((e) => [e.id, e.action, e.source])).toEqual([
        ['a2', 'UPDATED', 'AUDIT_LOG'],
        ['a1', 'CREATED', 'AUDIT_LOG'],
      ]);

      const [updated, created] = history.events;
      expect(updated).toMatchObject({ actorName: 'Boss', reason: 'Wrong amount entered', at: '2026-09-11T06:00:00.000Z' });
      const change = (field: string) => updated.changes.find((c) => c.field === field);
      expect(change('openingBalance')).toEqual({
        field: 'openingBalance',
        label: 'Amount',
        before: 10000,
        after: 12000,
        kind: 'money',
      });
      expect(change('openingDate')).toEqual({
        field: 'openingDate',
        label: 'Date',
        before: '2026-09-10',
        after: '2026-09-09',
        kind: 'date',
      });
      // Van id resolved to the plate number (one batched lookup).
      expect(change('vanId')).toEqual({ field: 'vanId', label: 'Van', before: null, after: 'LEA-9', kind: 'text' });
      expect(change('source')).toMatchObject({ before: null, after: 'Refund' });
      expect(updated.summary.startsWith('Amount changed ₨10,000 → ₨12,000')).toBe(true);

      expect(created.summary).toBe('Created');
      expect(created.changes.find((c) => c.field === 'openingBalance')).toMatchObject({ before: null, after: 10000 });
    });

    it('resolves van ids with ONE batched van query (scoped to the vendor) and skips it when no van is referenced', async () => {
      const withVan = makeReadService({
        manual: [manual('m1', '2026-09-09T00:00:00Z', 1)],
        audit: [
          auditRow('a1', 'VanCashOpeningBalance', 'm1', 'UPDATED', '2026-09-11T06:00:00Z', {
            before: { vanId: 'van-1' },
            after: { vanId: 'van-2' },
            reason: 'Moved to the right van',
          }),
        ],
        vans: [
          { id: 'van-1', vendorId: VENDOR_ID, plateNumber: 'AAA-1' },
          { id: 'van-2', vendorId: VENDOR_ID, plateNumber: 'BBB-2' },
        ],
      });
      const history = await withVan.svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm1');
      expect(withVan.prisma.van.findMany).toHaveBeenCalledTimes(1);
      expect(withVan.prisma.van.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['van-1', 'van-2'] }, vendorId: VENDOR_ID } }),
      );
      expect(history.events[0].changes).toEqual([
        { field: 'vanId', label: 'Van', before: 'AAA-1', after: 'BBB-2', kind: 'text' },
      ]);

      const noVan = makeReadService({
        manual: [manual('m1', '2026-09-09T00:00:00Z', 1)],
        audit: [
          auditRow('a1', 'VanCashOpeningBalance', 'm1', 'UPDATED', '2026-09-11T06:00:00Z', {
            before: { openingBalance: 1 },
            after: { openingBalance: 2 },
            reason: 'Typo fixed',
          }),
        ],
      });
      await noVan.svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm1');
      expect(noVan.prisma.van.findMany).not.toHaveBeenCalled();
      expect(noVan.prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('an entry with no CREATED audit row gets a synthesised RECORD event (oldest, last)', async () => {
      const { svc } = makeReadService({
        manual: [manual('m1', '2026-09-10T00:00:00Z', 500, { createdAt: iso('2026-09-10T07:00:00Z'), setBy: { name: 'Owner' } })],
        audit: [
          auditRow('a2', 'VanCashOpeningBalance', 'm1', 'VOIDED', '2026-09-12T06:00:00Z', {
            before: { status: 'ACTIVE' },
            after: { status: 'VOIDED', voidReason: 'Entered twice' },
            reason: 'Entered twice',
          }),
        ],
      });
      const history = await svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm1');
      expect(history.events.map((e) => [e.action, e.source])).toEqual([
        ['VOIDED', 'AUDIT_LOG'],
        ['CREATED', 'RECORD'],
      ]);
      expect(history.events[0]).toMatchObject({ summary: 'Voided — Entered twice', reason: 'Entered twice' });
      expect(history.events[1]).toMatchObject({
        actorName: 'Owner',
        at: '2026-09-10T07:00:00.000Z',
        summary: 'Created',
        reason: null,
        changes: [],
      });
    });

    it('a record with no audit rows at all still returns its header + the synthesised CREATED event', async () => {
      const { svc } = makeReadService({ handovers: [handover('h1', '2026-09-10T00:00:00Z', 5000)] });
      const history = await svc.getEntryHistory(VENDOR_ID, 'VAN_CASH_HANDOVER', 'h1');
      expect(history.entry).toMatchObject({ sourceType: 'VAN_CASH_HANDOVER', amount: 5000, status: 'APPROVED', recordedByName: 'Driver' });
      expect(history.events).toHaveLength(1);
      expect(history.events[0]).toMatchObject({ action: 'CREATED', source: 'RECORD', actorName: 'Driver', summary: 'Sheet closed' });
    });

    it('legacy expense action CLOSED_EXPENSE_CORRECTED is normalised to CORRECTED (reason from correctionNote)', async () => {
      const { svc } = makeReadService({
        expenses: [expense('e1', '2026-09-10T06:00:00Z', 300)],
        audit: [
          auditRow('a1', 'Expense', 'e1', 'CLOSED_EXPENSE_CORRECTED', '2026-09-11T06:00:00Z', {
            before: { amount: 500, category: 'OTHER' },
            after: { amount: 300, category: 'OTHER', correctionNote: 'Wrong price' },
          }),
          auditRow('a2', 'Expense', 'e1', 'UPDATED', '2026-09-12T06:00:00Z', {
            before: { description: 'Old', paidFromCash: true },
            after: { description: 'New', paidFromCash: false },
          }),
        ],
      });
      const history = await svc.getEntryHistory(VENDOR_ID, 'EXPENSE', 'e1');
      const [updated, corrected] = history.events;
      expect(updated).toMatchObject({ action: 'UPDATED', reason: null });
      expect(updated.changes).toEqual([
        { field: 'description', label: 'Description', before: 'Old', after: 'New', kind: 'text' },
        { field: 'paidFromCash', label: 'Paid from cash', before: true, after: false, kind: 'boolean' },
      ]);
      expect(corrected).toMatchObject({ action: 'CORRECTED', reason: 'Wrong price', source: 'AUDIT_LOG' });
      // Only the differing field is listed; the correction note is the reason, not a "change".
      expect(corrected.changes).toEqual([
        { field: 'amount', label: 'Amount', before: 500, after: 300, kind: 'money' },
      ]);
      expect(corrected.summary).toBe('Corrected — Amount changed ₨500 → ₨300');
      // Synthesised CREATED is last.
      expect(history.events[2]).toMatchObject({ action: 'CREATED', source: 'RECORD', actorName: 'Accountant' });
    });

    it('other legacy raw actions: CLOSED_EXPENSE_VOIDED / DELETED -> VOIDED, CLOSED_EXPENSE_ADDED -> CREATED, unknown -> OTHER', async () => {
      const { svc } = makeReadService({
        expenses: [expense('e1', '2026-09-10T06:00:00Z', 300)],
        audit: [
          auditRow('a1', 'Expense', 'e1', 'CLOSED_EXPENSE_ADDED', '2026-09-10T06:00:00Z', { after: { amount: 300 } }),
          auditRow('a2', 'Expense', 'e1', 'CLOSED_EXPENSE_VOIDED', '2026-09-11T06:00:00Z', {
            before: { amount: 300, correctionNote: 'Duplicate receipt' },
          }),
          auditRow('a3', 'Expense', 'e1', 'DELETED', '2026-09-12T06:00:00Z', { before: { amount: 300 } }),
          auditRow('a4', 'Expense', 'e1', 'SOMETHING_ELSE', '2026-09-13T06:00:00Z', {}),
        ],
      });
      const events = (await svc.getEntryHistory(VENDOR_ID, 'EXPENSE', 'e1')).events;
      expect(events.map((e) => e.action)).toEqual(['OTHER', 'VOIDED', 'VOIDED', 'CREATED']);
      expect(events[1].summary).toBe('Deleted');
      expect(events[2]).toMatchObject({ summary: 'Voided — Duplicate receipt', reason: 'Duplicate receipt' });
      expect(events[0].summary).toBe('Something else');
    });

    it('legacy handover shapes: APPROVED (adjusted) and CORRECTED (delta)', async () => {
      const { svc } = makeReadService({
        handovers: [handover('h1', '2026-09-10T00:00:00Z', 450)],
        audit: [
          auditRow('a1', 'VanCashHandover', 'h1', 'APPROVED', '2026-09-11T06:00:00Z', {
            before: { status: 'PENDING', amount: 500 },
            after: { status: 'APPROVED', amount: 450, approvedAmount: 450, adjustmentReason: 'Short by 50' },
          }),
          auditRow('a2', 'VanCashHandover', 'h1', 'CORRECTED', '2026-09-12T06:00:00Z', {
            before: { currentTotal: 1000 },
            after: { newCashAmount: 1500, delta: 500, correctsEntryId: 'abcdef12-0000' },
          }),
        ],
      });
      const events = (await svc.getEntryHistory(VENDOR_ID, 'VAN_CASH_HANDOVER', 'h1')).events;
      const [corrected, approved] = events;
      expect(corrected).toMatchObject({ action: 'CORRECTED', summary: 'Corrected by ₨500' });
      expect(corrected.changes.find((c) => c.field === 'total')).toMatchObject({ before: 1000, after: 1500, kind: 'money' });
      expect(corrected.changes.find((c) => c.field === 'correctsEntryId')).toMatchObject({ after: '#abcdef12' });
      expect(approved).toMatchObject({
        action: 'APPROVED',
        summary: 'Approved (adjusted ₨500 → ₨450)',
        reason: 'Short by 50',
      });
      expect(approved.changes.find((c) => c.field === 'status')).toMatchObject({
        before: 'PENDING',
        after: 'APPROVED',
        kind: 'status',
      });
      // The reason key is never repeated as a "change".
      expect(approved.changes.some((c) => c.field === 'adjustmentReason')).toBe(false);
    });

    it('crew cash edit: employee ids resolved to names, payroll-twin pointer labelled, missing actor name looked up by id', async () => {
      const { svc, prisma } = makeReadService({
        crew: [crewCash('cc1', '2026-09-10T06:00:00Z', 150)],
        users: [
          { id: 'emp-1', vendorId: VENDOR_ID, name: 'Ali' },
          { id: 'emp-2', vendorId: VENDOR_ID, name: 'Bilal' },
          { id: 'actor-7', vendorId: VENDOR_ID, name: 'Zed' },
        ],
        audit: [
          auditRow(
            'a1',
            'StandaloneCrewCashExpense',
            'cc1',
            'UPDATED',
            '2026-09-11T06:00:00Z',
            {
              before: { employeeId: 'emp-1', amount: 100, ledgerTwinId: 'aaaaaaaa-1111' },
              after: { employeeId: 'emp-2', amount: 150, ledgerTwinId: 'bbbbbbbb-2222' },
              reason: 'Wrong person',
            },
            { userName: null, userId: 'actor-7' },
          ),
          auditRow('a0', 'StandaloneCrewCashExpense', 'cc1', 'CREATED', '2026-09-10T06:00:00Z', {
            after: { employeeId: 'emp-1', category: 'MEAL', amount: 100 },
          }, { userName: null, userId: null }),
        ],
      });
      const history = await svc.getEntryHistory(VENDOR_ID, 'STANDALONE_CREW_CASH', 'cc1');
      const [updated, created] = history.events;
      expect(updated.actorName).toBe('Zed');
      expect(created.actorName).toBeNull();
      expect(updated.changes).toEqual([
        { field: 'employeeId', label: 'Employee', before: 'Ali', after: 'Bilal', kind: 'text' },
        { field: 'amount', label: 'Amount', before: 100, after: 150, kind: 'money' },
        { field: 'ledgerTwinId', label: 'Payroll entry', before: '#aaaaaaaa', after: '#bbbbbbbb', kind: 'text' },
      ]);
      // The twin pointer is bookkeeping — never the headline.
      expect(updated.summary).toBe('Employee changed Ali → Bilal; Amount changed ₨100 → ₨150');
      // One batched user lookup covers both the employees and the actor.
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('vendor scoping: another vendor\'s audit rows never appear, and another vendor\'s record is a 404', async () => {
      const { svc } = makeReadService({
        manual: [manual('m1', '2026-09-10T00:00:00Z', 500), manual('m-foreign', '2026-09-10T00:00:00Z', 500, { vendorId: OTHER_VENDOR })],
        audit: [
          auditRow('mine', 'VanCashOpeningBalance', 'm1', 'UPDATED', '2026-09-11T06:00:00Z', {
            before: { openingBalance: 1 },
            after: { openingBalance: 2 },
            reason: 'mine',
          }),
          auditRow('theirs', 'VanCashOpeningBalance', 'm1', 'UPDATED', '2026-09-12T06:00:00Z', { reason: 'leak' }, { vendorId: OTHER_VENDOR }),
          auditRow('other-entity', 'OfficeCashRemittance', 'm1', 'UPDATED', '2026-09-12T06:00:00Z', { reason: 'leak' }),
        ],
      });
      const history = await svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm1');
      expect(history.events.map((e) => e.id)).toEqual(['mine', 'record:OPENING_BALANCE:m1']);
      expect(JSON.stringify(history)).not.toContain('leak');

      await expect(svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'm-foreign')).rejects.toThrow(NotFoundException);
      await expect(svc.getEntryHistory(VENDOR_ID, 'OPENING_BALANCE', 'nope')).rejects.toThrow(NotFoundException);
      await expect(svc.getEntryHistory(VENDOR_ID, 'NOT_A_TYPE', 'm1')).rejects.toThrow(NotFoundException);
    });

    it('remittance void audit reads back as VOIDED with the reason; a fuel-card top-up header is voided', async () => {
      const { svc } = makeReadService({
        remittances: [remittance('r1', '2026-09-10T06:00:00Z', 1000, OfficeCashRemittanceStatus.VOIDED, { submittedBy: { name: 'Accountant' } })],
        fuel: [fuelTopUp('f1', '2026-09-10T06:00:00Z', 200, FuelCardTopUpStatus.VOIDED)],
        audit: [
          auditRow('a1', 'OfficeCashRemittance', 'r1', 'VOIDED', '2026-09-11T06:00:00Z', {
            before: { status: 'APPROVED' },
            after: { status: 'VOIDED', voidReason: 'Duplicate deposit' },
          }),
        ],
      });
      const rem = await svc.getEntryHistory(VENDOR_ID, 'OFFICE_CASH_REMITTANCE', 'r1');
      expect(rem.entry).toMatchObject({ isVoided: true, status: 'VOIDED', title: 'Handover to Owner' });
      expect(rem.events[0]).toMatchObject({ action: 'VOIDED', summary: 'Voided — Duplicate deposit', reason: 'Duplicate deposit' });

      const fuel = await svc.getEntryHistory(VENDOR_ID, 'FUEL_CARD_TOPUP', 'f1');
      expect(fuel.entry).toMatchObject({ isVoided: true, title: 'Fuel card top-up — PSO Card' });
    });
  });


  // ─── P4 — accounting-period integration ────────────────────────────────────

  describe('P4 accounting periods — row flags', () => {
    const USER_P4 = { userId: 'user-1', vendorId: VENDOR_ID, name: 'Tester' } as any;
    const CLOSED_REASON =
      'This entry belongs to a closed accounting period (Aug 2026). Ask an admin to make this change.';
    const data: Data = {
      manual: [manual('m-aug', '2026-08-20T00:00:00Z', 1000), manual('m-sep', '2026-09-05T00:00:00Z', 500)],
      expenses: [expense('e-aug', '2026-08-25T00:00:00Z', 50)],
    };
    const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.sourceRecordId, r]));

    it('stamps periodLabel + periodClosed on every returned row from ONE closed-set load', async () => {
      const { svc, periodStore } = makeReadService(data, () => false, ['2026-08']);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      const rows = byId(page.data);
      expect(rows['m-aug']).toMatchObject({ periodLabel: '2026-08', periodClosed: true });
      expect(rows['e-aug']).toMatchObject({ periodLabel: '2026-08', periodClosed: true });
      expect(rows['m-sep']).toMatchObject({ periodLabel: '2026-09', periodClosed: false });
      expect(periodStore.getClosedLabels).toHaveBeenCalledTimes(1);
      expect(periodStore.getClosedLabels).toHaveBeenCalledWith(VENDOR_ID);
    });

    it('non-admin: a closed-period row loses canEdit/canVoid and explains why; open rows are untouched', async () => {
      const { svc } = makeReadService(data, (_u, p) => p === 'van_cash_ledger:manage', ['2026-08']);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      const rows = byId(page.data);
      expect(rows['m-aug']).toMatchObject({
        canEdit: false,
        canVoid: false,
        canOverride: false,
        editBlockedReason: CLOSED_REASON,
      });
      expect(rows['m-sep']).toMatchObject({ canEdit: true, canVoid: true, canOverride: false, editBlockedReason: null });
    });

    it('a row that was never editable/voidable gets no misleading "ask an admin" reason', async () => {
      const { svc } = makeReadService(data, () => false, ['2026-08']);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      expect(byId(page.data)['e-aug']).toMatchObject({ canEdit: false, canVoid: false, editBlockedReason: null });
    });

    it('overrider: flags are left as-is, canOverride is true on EVERY row, and the permission is resolved once', async () => {
      const { svc, permissions } = makeReadService(
        data,
        (_u, p) => p === 'van_cash_ledger:manage' || p === 'van_cash_ledger:override_lock',
        ['2026-08'],
      );
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      const rows = byId(page.data);
      expect(rows['m-aug']).toMatchObject({ canEdit: true, canVoid: true, canOverride: true, editBlockedReason: null });
      expect(rows['m-sep']).toMatchObject({ canEdit: true, canVoid: true, canOverride: true });
      expect(page.data.every((r) => r.canOverride === true)).toBe(true);
      const overrideChecks = permissions.can.mock.calls.filter((c: any[]) => c[1] === 'van_cash_ledger:override_lock');
      expect(overrideChecks).toEqual([['user-1', 'van_cash_ledger:override_lock']]);
    });

    it('a crew-cash row with its own twin-lock reason keeps THAT reason inside a closed period', async () => {
      const { svc } = makeReadService(
        {
          crew: [
            crewCash('c-aug', '2026-08-20T06:00:00Z', 10, StandaloneCrewCashStatus.ACTIVE, {
              staffLedgerEntry: { payrollEntryId: 'pe-1', status: LedgerEntryStatus.POSTED },
            }),
          ],
        },
        (_u, p) => p === 'crew_cash:edit' || p === 'crew_cash:delete',
        ['2026-08'],
      );
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      expect(page.data[0]).toMatchObject({ canEdit: false, canVoid: false, periodClosed: true });
      expect(page.data[0].editBlockedReason).toBe(STANDALONE_CREW_CASH_LOCKED_REASON);
    });

    it('no closed periods: periodClosed false everywhere, the override permission is never looked up', async () => {
      const { svc, permissions, periodStore } = makeReadService(data, () => true, []);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      expect(page.data.every((r) => r.periodClosed === false && r.canOverride === false)).toBe(true);
      expect(page.data.map((r) => r.periodLabel).sort()).toEqual(['2026-08', '2026-08', '2026-09']);
      expect(periodStore.getClosedLabels).toHaveBeenCalledTimes(1);
      expect(permissions.can).not.toHaveBeenCalledWith('user-1', 'van_cash_ledger:override_lock');
    });

    it('closed periods exist but none is on the returned page: the override permission is still not looked up', async () => {
      const { svc, permissions } = makeReadService(data, () => true, ['2026-07']);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      expect(page.data.every((r) => r.periodClosed === false)).toBe(true);
      expect(permissions.can).not.toHaveBeenCalledWith('user-1', 'van_cash_ledger:override_lock');
    });

    it('no user: periodClosed is stamped, canOverride is false and no permission is consulted', async () => {
      const { svc, permissions } = makeReadService(data, () => true, ['2026-08']);
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 });
      const rows = byId(page.data);
      expect(rows['m-aug']).toMatchObject({ periodClosed: true, canOverride: false });
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('a redirected handover row counts on its current-period date, carries relatesToDate and says "for 12 Aug"', async () => {
      const { svc } = makeReadService(
        {
          handovers: [
            handover('h-redirected', '2026-09-15T00:00:00Z', 300, { relatesToDate: iso('2026-08-12T00:00:00Z') }),
            handover('h-normal', '2026-09-14T00:00:00Z', 200),
          ],
        },
        () => false,
        ['2026-08'],
      );
      const page = await svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      const rows = byId(page.data);
      expect(rows['h-redirected']).toMatchObject({
        date: '2026-09-15T00:00:00.000Z',
        periodLabel: '2026-09',
        periodClosed: false,
        relatesToDate: '2026-08-12T00:00:00.000Z',
      });
      expect(rows['h-redirected'].title).toMatch(/ — for 12 Aug$/);
      expect(rows['h-normal'].relatesToDate).toBeNull();
      expect(rows['h-normal'].title).not.toMatch(/ — for /);
    });

    it('I2/I3: the flags never change amounts, running balances or the day statements', async () => {
      const open = makeReadService(data, () => false, []);
      const closed = makeReadService(data, () => false, ['2026-08']);
      const a = await open.svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      const b = await closed.svc.getTimeline(VENDOR_ID, { limit: 50 }, USER_P4);
      expect(b.data.map((r) => [r.sourceRecordId, r.amount, r.runningBalance])).toEqual(
        a.data.map((r) => [r.sourceRecordId, r.amount, r.runningBalance]),
      );
      expect(b.meta.dayStatements).toEqual(a.meta.dayStatements);
    });
  });

  describe('P4 accounting periods — closing balance + statement for the period service', () => {
    const data: Data = {
      manual: [
        manual('m-jul', '2026-07-05T00:00:00Z', 400),
        manual('m-aug', '2026-08-10T00:00:00Z', 1000),
        manual('m-sep', '2026-09-05T00:00:00Z', 700),
      ],
      handovers: [
        handover('h-aug', '2026-08-31T00:00:00Z', 500),
        // vanId is irrelevant: the closing balance is OFFICE-WIDE.
        handover('h-other-van', '2026-08-15T00:00:00Z', 100, { vanId: OTHER_VAN_ID }),
      ],
      expenses: [
        expense('e-aug', '2026-08-20T00:00:00Z', 200),
        // 23:00 PKT on 31 Aug — still August. 00:30 PKT on 1 Sep — September.
        expense('e-late-aug', '2026-08-31T18:00:00Z', 30),
        expense('e-early-sep', '2026-08-31T19:30:00Z', 999),
      ],
      remittances: [remittance('r-sep', '2026-09-01T00:00:00Z', 100)],
    };

    it('getClosingBalanceAsOf: net of everything dated up to and including the PKT last day (office-wide)', async () => {
      const { svc } = makeReadService(data);
      // 400 + 1000 + 500 + 100 − 200 − 30 = 1770
      expect(await svc.getClosingBalanceAsOf(VENDOR_ID, '2026-08-31')).toBe(1770);
      // Sep entries are in once the day is included: 1770 + 700 − 999 − 100
      expect(await svc.getClosingBalanceAsOf(VENDOR_ID, '2026-09-30')).toBe(1371);
      // Before anything: 0
      expect(await svc.getClosingBalanceAsOf(VENDOR_ID, '2026-06-30')).toBe(0);
    });

    it('getClosingBalanceAsOf equals the live availableBalance when the day is past the last row', async () => {
      const { svc } = makeReadService(data);
      const stats = await svc.getStats(VENDOR_ID, {});
      expect(await svc.getClosingBalanceAsOf(VENDOR_ID, '2026-12-31')).toBe(stats.availableBalance);
    });

    it('getStatementForRange: office statement for the range with broughtForward = everything before firstDay', async () => {
      const { svc } = makeReadService(data);
      const statement = await svc.getStatementForRange(VENDOR_ID, '2026-08-01', '2026-08-31');
      expect(statement).toMatchObject({
        broughtForward: 400,
        sheetCashIn: 600, // 500 + 100 (all vans — office scope)
        officeCashIn: 1000,
        totalCashIn: 1600,
        officeExpenses: 230,
        totalExpenses: 230,
        ownerTransfer: 0,
        net: 1370,
        expectedClosing: 1770,
      });
    });

    it('getStatementForRange closes on the same figure as getClosingBalanceAsOf and equals getSummary().statement', async () => {
      const { svc } = makeReadService(data);
      const statement = await svc.getStatementForRange(VENDOR_ID, '2026-08-01', '2026-08-31');
      expect(statement.expectedClosing).toBe(await svc.getClosingBalanceAsOf(VENDOR_ID, '2026-08-31'));
      const summary = await svc.getSummary(VENDOR_ID, { from: '2026-08-01', to: '2026-08-31' } as any);
      expect(statement).toEqual(summary.statement);
    });
  });
});
