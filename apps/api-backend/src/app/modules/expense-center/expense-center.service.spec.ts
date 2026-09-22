import { CrewCashCategory, ExpenseCategory, StaffLedgerCategory } from '@prisma/client';
import { ExpenseCenterService } from './expense-center.service';

/**
 * Behavioural tests for the Expense Center's four sources, with focus on
 * standalone crew cash (crew cash recorded WITHOUT a Daily Sheet).
 *
 * The prisma fake below is a tiny in-memory store that honours the `where`
 * clauses the service actually builds (vendorId / status / date range /
 * employeeId / `category: { not }`) — that is what lets these tests assert the
 * real counting rules (VOIDED excluded, twin ledger entry never counted) rather
 * than just echoing mocked totals.
 */

const VENDOR = 'vendor-1';

interface FakeStandalone {
  id: string;
  vendorId: string;
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  notes: string | null;
  date: Date;
  status: 'ACTIVE' | 'VOIDED';
}

interface FakeSheetCrewCash {
  id: string;
  vendorId: string;
  employeeId: string;
  category: CrewCashCategory;
  amount: number;
  notes: string | null;
  date: Date;
  dailySheetId: string;
}

interface FakeLedger {
  id: string;
  vendorId: string;
  userId: string;
  category: StaffLedgerCategory;
  amount: number;
  status: 'ACTIVE' | 'VOIDED';
  effectiveDate: Date;
}

interface FakeStore {
  standalone: FakeStandalone[];
  sheetCrewCash: FakeSheetCrewCash[];
  ledger: FakeLedger[];
}

function inRange(date: Date, filter?: { gte?: Date; lte?: Date }): boolean {
  if (!filter) return true;
  if (filter.gte && date < filter.gte) return false;
  if (filter.lte && date > filter.lte) return false;
  return true;
}

function buildPrisma(store: FakeStore) {
  const matchStandalone = (where: any) =>
    store.standalone.filter(
      (r) =>
        r.vendorId === where.vendorId &&
        (!where.status || r.status === where.status) &&
        (!where.employeeId || r.employeeId === where.employeeId) &&
        inRange(r.date, where.date),
    );
  const matchSheetCrewCash = (where: any) =>
    store.sheetCrewCash.filter(
      (r) =>
        r.vendorId === where.vendorId &&
        (!where.employeeId || r.employeeId === where.employeeId) &&
        inRange(r.date, where.date),
    );
  const matchLedger = (where: any) =>
    store.ledger.filter((r) => {
      if (r.vendorId !== where.vendorId) return false;
      if (where.category?.not && r.category === where.category.not) return false;
      if (where.category?.in && !where.category.in.includes(r.category)) return false;
      if (where.status?.not && r.status === where.status.not) return false;
      if (where.userId && r.userId !== where.userId) return false;
      return inRange(r.effectiveDate, where.effectiveDate);
    });
  const sum = (rows: Array<{ amount: number }>) => ({
    _sum: { amount: rows.length ? rows.reduce((a, r) => a + r.amount, 0) : null },
  });
  const newestFirst = <T extends { date?: Date; effectiveDate?: Date }>(rows: T[], take: number) =>
    [...rows]
      .sort((a, b) => (b.date ?? b.effectiveDate!).getTime() - (a.date ?? a.effectiveDate!).getTime())
      .slice(0, take);

  return {
    expense: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    staffLedgerEntry: {
      findMany: jest.fn(async ({ where, take }: any) =>
        newestFirst(
          matchLedger(where).map((r) => ({
            ...r,
            description: null,
            date: undefined,
            user: { name: 'Ledger Emp' },
            createdBy: { name: 'Mgr' },
            payrollEntryId: null,
          })),
          take ?? Infinity,
        ),
      ),
      count: jest.fn(async ({ where }: any) => matchLedger(where).length),
    },
    crewCashDistribution: {
      aggregate: jest.fn(async ({ where }: any) => sum(matchSheetCrewCash(where))),
      findMany: jest.fn(async ({ where, take }: any) =>
        newestFirst(
          matchSheetCrewCash(where).map((r) => ({
            ...r,
            employee: { name: 'Sheet Emp' },
            distributedBy: { name: 'Salesman' },
            dailySheet: { van: { plateNumber: 'VAN-1' } },
            syncedAt: null,
          })),
          take,
        ),
      ),
      count: jest.fn(async ({ where }: any) => matchSheetCrewCash(where).length),
    },
    standaloneCrewCashExpense: {
      aggregate: jest.fn(async ({ where }: any) => sum(matchStandalone(where))),
      findMany: jest.fn(async ({ where, take }: any) =>
        newestFirst(
          matchStandalone(where).map((r) => ({
            ...r,
            employee: { name: 'Standalone Emp' },
            createdBy: { name: 'Admin' },
          })),
          take,
        ),
      ),
      count: jest.fn(async ({ where }: any) => matchStandalone(where).length),
    },
  };
}

function standaloneRow(over: Partial<Omit<FakeStandalone, 'date'>> & { id: string; date: string }): FakeStandalone {
  const { date, ...rest } = over;
  return {
    vendorId: VENDOR,
    employeeId: 'emp-1',
    category: CrewCashCategory.MEAL,
    amount: 500,
    notes: null,
    status: 'ACTIVE',
    ...rest,
    date: new Date(date),
  };
}

function sheetRow(over: Partial<Omit<FakeSheetCrewCash, 'date'>> & { id: string; date: string }): FakeSheetCrewCash {
  const { date, ...rest } = over;
  return {
    vendorId: VENDOR,
    employeeId: 'emp-1',
    category: CrewCashCategory.MEAL,
    amount: 1000,
    notes: null,
    dailySheetId: 'sheet-abcdef123',
    ...rest,
    date: new Date(date),
  };
}

// The twin StaffLedgerEntry that every crew cash row (standalone or sheet) has.
function twin(id: string, amount: number, date: string): FakeLedger {
  return {
    id,
    vendorId: VENDOR,
    userId: 'emp-1',
    category: StaffLedgerCategory.CREW_CASH,
    amount: -amount,
    status: 'ACTIVE',
    effectiveDate: new Date(date),
  };
}

const CURRENT = { from: '2026-09-01', to: '2026-09-10' };

describe('ExpenseCenterService — standalone crew cash', () => {
  let store: FakeStore;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ExpenseCenterService;

  beforeEach(() => {
    store = { standalone: [], sheetCrewCash: [], ledger: [] };
    prisma = buildPrisma(store);
    service = new ExpenseCenterService(prisma as never);
  });

  describe('getSummary', () => {
    it('counts an ACTIVE standalone row in the totals, as cash, in the EMPLOYEES domain and CREW_CASH category', async () => {
      store.standalone.push(standaloneRow({ id: 's1', date: '2026-09-05T08:00:00Z', amount: 750 }));

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.totalSpend).toBe(750);
      expect(summary.cashAmount).toBe(750);
      expect(summary.cardAmount).toBe(0);
      expect(summary.byDomain.find((d) => d.domain === 'EMPLOYEES')?.amount).toBe(750);
      expect(summary.topCategory).toEqual({ category: 'CREW_CASH', label: 'Crew Cash', amount: 750 });
    });

    it('excludes a VOIDED standalone row', async () => {
      store.standalone.push(
        standaloneRow({ id: 's1', date: '2026-09-05T08:00:00Z', amount: 750 }),
        standaloneRow({ id: 's2', date: '2026-09-06T08:00:00Z', amount: 9999, status: 'VOIDED' }),
      );

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.totalSpend).toBe(750);
      expect(prisma.standaloneCrewCashExpense.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', vendorId: VENDOR }) }),
      );
    });

    it('ignores standalone rows outside the window and other vendors', async () => {
      store.standalone.push(
        standaloneRow({ id: 's-in', date: '2026-09-05T08:00:00Z', amount: 100 }),
        standaloneRow({ id: 's-out', date: '2026-09-20T08:00:00Z', amount: 5000 }),
        standaloneRow({ id: 's-other', date: '2026-09-05T08:00:00Z', amount: 7000, vendorId: 'vendor-2' }),
      );

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.totalSpend).toBe(100);
    });

    it('counts sheet crew cash and standalone crew cash once each — the CREW_CASH ledger twins are never added', async () => {
      store.sheetCrewCash.push(sheetRow({ id: 'c1', date: '2026-09-04T08:00:00Z', amount: 1000 }));
      store.standalone.push(standaloneRow({ id: 's1', date: '2026-09-05T08:00:00Z', amount: 500 }));
      // Each crew cash row has a synced StaffLedgerEntry twin — must not be counted.
      store.ledger.push(twin('l1', 1000, '2026-09-04T08:00:00Z'), twin('l2', 500, '2026-09-05T08:00:00Z'));
      // A genuine payroll entry IS counted, once.
      store.ledger.push({
        id: 'l3',
        vendorId: VENDOR,
        userId: 'emp-1',
        category: StaffLedgerCategory.BONUS,
        amount: 200,
        status: 'ACTIVE',
        effectiveDate: new Date('2026-09-07T08:00:00Z'),
      });

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.totalSpend).toBe(1700); // 1000 + 500 + 200, NOT 3200
      expect(summary.cashAmount).toBe(1700);
      expect(summary.byDomain.find((d) => d.domain === 'EMPLOYEES')?.amount).toBe(1700);
      // Crew Cash rolls up as ONE category: 1000 + 500.
      expect(summary.topCategory).toEqual({ category: 'CREW_CASH', label: 'Crew Cash', amount: 1500 });
      expect(prisma.staffLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: { not: StaffLedgerCategory.CREW_CASH } }),
        }),
      );
    });

    it('uses standalone crew cash in the previous-period comparison', async () => {
      // Current window (Sep 1-10): 600. Previous equal-length window ends Aug 31: 300.
      store.standalone.push(
        standaloneRow({ id: 'cur', date: '2026-09-05T08:00:00Z', amount: 600 }),
        standaloneRow({ id: 'prev', date: '2026-08-28T08:00:00Z', amount: 300 }),
        standaloneRow({ id: 'prev-voided', date: '2026-08-28T09:00:00Z', amount: 9000, status: 'VOIDED' }),
      );

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.totalSpend).toBe(600);
      expect(summary.momDeltaPercent).toBe(100); // (600 - 300) / 300
    });

    it('reports a null delta when the previous period only had voided standalone rows', async () => {
      store.standalone.push(
        standaloneRow({ id: 'cur', date: '2026-09-05T08:00:00Z', amount: 600 }),
        standaloneRow({ id: 'prev-voided', date: '2026-08-28T09:00:00Z', amount: 9000, status: 'VOIDED' }),
      );

      const summary = await service.getSummary(VENDOR, CURRENT);

      expect(summary.momDeltaPercent).toBeNull();
    });
  });

  describe('getTimeline', () => {
    beforeEach(() => {
      store.sheetCrewCash.push(sheetRow({ id: 'c1', date: '2026-09-04T08:00:00Z', amount: 1000 }));
      store.standalone.push(
        standaloneRow({ id: 's1', date: '2026-09-06T08:00:00Z', amount: 500, notes: 'lunch' }),
        standaloneRow({ id: 's2', date: '2026-09-02T08:00:00Z', amount: 250 }),
        standaloneRow({ id: 's-voided', date: '2026-09-05T08:00:00Z', amount: 9999, status: 'VOIDED' }),
      );
      store.ledger.push(twin('l1', 500, '2026-09-06T08:00:00Z'));
      store.ledger.push({
        id: 'l2',
        vendorId: VENDOR,
        userId: 'emp-1',
        category: StaffLedgerCategory.BONUS,
        amount: 300,
        status: 'ACTIVE',
        effectiveDate: new Date('2026-09-05T08:00:00Z'),
      });
    });

    it('merges standalone rows in date order with an exact total, excluding VOIDED rows and ledger twins', async () => {
      const result = await service.getTimeline(VENDOR, { ...CURRENT, page: 1, limit: 20 });

      expect(result.data.map((r) => r.id)).toEqual([
        'STANDALONE_CREW_CASH:s1', // Sep 6
        'STAFF_LEDGER:l2', // Sep 5 (BONUS)
        'CREW_CASH:c1', // Sep 4
        'STANDALONE_CREW_CASH:s2', // Sep 2
      ]);
      expect(result.meta.total).toBe(4);

      const standalone = result.data[0];
      expect(standalone.sourceType).toBe('STANDALONE_CREW_CASH');
      expect(standalone.sourceRecordId).toBe('s1');
      expect(standalone.sourceBadge).toBe('via Cash Ledger');
      expect(standalone.title).toBe('Crew Cash — MEAL: lunch');
      expect(standalone.locked).toBe(true);
      expect(standalone.lockedReason).toBe('Managed in the Cash Ledger — edit or void it there.');
      expect(standalone.category).toBe('CREW_CASH');
      // Sheet crew cash keeps its own badge.
      expect(result.data[2].sourceBadge).toBe('via Daily Sheet #SHEET-AB');
    });

    it('paginates the merged set with a stable total', async () => {
      const page1 = await service.getTimeline(VENDOR, { ...CURRENT, page: 1, limit: 2 });
      const page2 = await service.getTimeline(VENDOR, { ...CURRENT, page: 2, limit: 2 });

      expect(page1.data.map((r) => r.id)).toEqual(['STANDALONE_CREW_CASH:s1', 'STAFF_LEDGER:l2']);
      expect(page2.data.map((r) => r.id)).toEqual(['CREW_CASH:c1', 'STANDALONE_CREW_CASH:s2']);
      expect(page1.meta.total).toBe(4);
      expect(page2.meta.total).toBe(4);
    });

    it('CREW_CASH category filter returns both crew-cash sources and nothing else', async () => {
      const result = await service.getTimeline(VENDOR, { ...CURRENT, category: 'CREW_CASH', page: 1, limit: 20 });

      expect(result.data.map((r) => r.id)).toEqual([
        'STANDALONE_CREW_CASH:s1',
        'CREW_CASH:c1',
        'STANDALONE_CREW_CASH:s2',
      ]);
      expect(result.meta.total).toBe(3);
      expect(prisma.expense.findMany).not.toHaveBeenCalled();
      expect(prisma.staffLedgerEntry.findMany).not.toHaveBeenCalled();
    });

    it('EMPLOYEES domain includes standalone crew cash; another domain excludes it', async () => {
      const employees = await service.getTimeline(VENDOR, { ...CURRENT, domain: 'EMPLOYEES', page: 1, limit: 20 });
      expect(employees.data.some((r) => r.sourceType === 'STANDALONE_CREW_CASH')).toBe(true);

      prisma.standaloneCrewCashExpense.findMany.mockClear();
      const vehicle = await service.getTimeline(VENDOR, { ...CURRENT, domain: 'VEHICLE', page: 1, limit: 20 });
      expect(vehicle.data.some((r) => r.sourceType === 'STANDALONE_CREW_CASH')).toBe(false);
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();
    });

    it('a non-crew-cash category excludes it', async () => {
      const result = await service.getTimeline(VENDOR, {
        ...CURRENT,
        category: StaffLedgerCategory.BONUS,
        page: 1,
        limit: 20,
      });

      expect(result.data.map((r) => r.id)).toEqual(['STAFF_LEDGER:l2']);
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();

      const expenseCat = await service.getTimeline(VENDOR, {
        ...CURRENT,
        category: ExpenseCategory.FUEL_EXPENSE,
        page: 1,
        limit: 20,
      });
      expect(expenseCat.data.some((r) => r.sourceType === 'STANDALONE_CREW_CASH')).toBe(false);
    });

    it('a van filter excludes standalone crew cash (it has no van) but keeps the sheet crew cash query', async () => {
      const result = await service.getTimeline(VENDOR, {
        ...CURRENT,
        vanId: '11111111-1111-1111-1111-111111111111',
        page: 1,
        limit: 20,
      });

      expect(result.data.some((r) => r.sourceType === 'STANDALONE_CREW_CASH')).toBe(false);
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();
      expect(prisma.standaloneCrewCashExpense.count).not.toHaveBeenCalled();
      expect(prisma.crewCashDistribution.findMany).toHaveBeenCalled();
    });

    it('an extraLabourId filter passes through to the Expense where clause and excludes every payroll-sourced table', async () => {
      await service.getTimeline(VENDOR, {
        ...CURRENT,
        extraLabourId: 'labour-1',
        page: 1,
        limit: 20,
      });

      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ extraLabourId: 'labour-1' }) }),
      );
      expect(prisma.staffLedgerEntry.findMany).not.toHaveBeenCalled();
      expect(prisma.crewCashDistribution.findMany).not.toHaveBeenCalled();
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();
    });

    it('an employee filter narrows standalone rows to that employee', async () => {
      store.standalone.push(
        standaloneRow({ id: 's-other', date: '2026-09-03T08:00:00Z', amount: 111, employeeId: 'emp-2' }),
      );

      const result = await service.getTimeline(VENDOR, { ...CURRENT, employeeId: 'emp-2', page: 1, limit: 20 });

      expect(result.data.map((r) => r.id)).toEqual(['STANDALONE_CREW_CASH:s-other']);
      expect(result.meta.total).toBe(1);
    });

    it('a CARD payment filter excludes standalone crew cash (it is cash)', async () => {
      const result = await service.getTimeline(VENDOR, { ...CURRENT, paymentMethod: 'CARD', page: 1, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(prisma.standaloneCrewCashExpense.findMany).not.toHaveBeenCalled();
    });

    it('a CASH payment filter keeps standalone crew cash', async () => {
      const result = await service.getTimeline(VENDOR, { ...CURRENT, paymentMethod: 'CASH', page: 1, limit: 20 });

      expect(result.data.some((r) => r.sourceType === 'STANDALONE_CREW_CASH')).toBe(true);
    });
  });
});
