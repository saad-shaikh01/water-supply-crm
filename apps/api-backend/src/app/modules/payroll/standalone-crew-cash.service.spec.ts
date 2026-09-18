import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CrewCashCategory, LedgerEntryStatus, StandaloneCrewCashStatus } from '@prisma/client';
import { StandaloneCrewCashService } from './standalone-crew-cash.service';
import { STANDALONE_CREW_CASH_LOCKED_REASON } from './standalone-crew-cash-lock.util';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const ROW_ID = 'scc-001';
const EMPLOYEE_ID = 'employee-001';
const OTHER_EMPLOYEE_ID = 'employee-002';
const OLD_TWIN_ID = 'twin-old';
const NEW_TWIN_ID = 'twin-new';

// A Manager who neither created the row nor the (system-created) twin.
const managerUser = { userId: 'manager-001', vendorId: VENDOR_ID, role: 'MANAGER', name: 'Manager' } as any;

const baseRow = {
  id: ROW_ID,
  vendorId: VENDOR_ID,
  employeeId: EMPLOYEE_ID,
  category: CrewCashCategory.TEA,
  amount: 100,
  notes: null as string | null,
  date: new Date('2026-09-10T07:00:00.000Z'), // 12:00 PKT on 2026-09-10
  status: StandaloneCrewCashStatus.ACTIVE,
  staffLedgerEntryId: OLD_TWIN_ID,
  createdById: 'someone-else',
  version: 3,
  editCount: 0,
  lastEditedAt: null as Date | null,
  updatedById: null as string | null,
};

const unlockedTwin = {
  id: OLD_TWIN_ID,
  vendorId: VENDOR_ID,
  userId: EMPLOYEE_ID,
  status: LedgerEntryStatus.POSTED,
  payrollEntryId: null as string | null,
  version: 7,
};
const lockedTwin = { ...unlockedTwin, payrollEntryId: 'payroll-entry-001' };
const voidedTwin = { ...unlockedTwin, status: LedgerEntryStatus.VOIDED };

// ─── factory ──────────────────────────────────────────────────────────────────

function makeService(
  opts: {
    row?: any;
    twin?: any;
    employeeExists?: boolean;
    casCount?: number;
    freshTwinStatus?: LedgerEntryStatus;
    guardRejects?: Error;
  } = {},
) {
  const { row = baseRow, twin = unlockedTwin, employeeExists = true, casCount = 1, freshTwinStatus, guardRejects } = opts;
  const order: string[] = [];

  let current = { ...row };
  const tx = {
    standaloneCrewCashExpense: {
      updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
        order.push('cas');
        if (casCount === 0) return { count: 0 };
        current = { ...current, version: current.version + (data.version?.increment ?? 0) };
        return { count: 1 };
      }),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        order.push('rowUpdate');
        const next: any = { ...current, ...data };
        if (data.editCount?.increment) next.editCount = current.editCount + data.editCount.increment;
        current = next;
        return current;
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...current })),
    },
    staffLedgerEntry: {
      findFirst: jest.fn().mockResolvedValue(twin),
      findUniqueOrThrow: jest.fn().mockResolvedValue(twin),
    },
  };

  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    standaloneCrewCashExpense: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findFirst: jest.fn().mockResolvedValue(employeeExists ? { id: 'some-user' } : null) },
    staffLedgerEntry: { findFirst: jest.fn().mockResolvedValue(twin) },
  };

  const staffLedger = {
    voidEntryTx: jest.fn().mockImplementation(async () => {
      order.push('voidTwin');
      return undefined;
    }),
    reverseTx: jest.fn().mockImplementation(async () => {
      order.push('reverseTwin');
      return { original: {}, reversal: { id: 'reversal-1' } };
    }),
    createTx: jest.fn().mockImplementation(async (_tx: any, _user: any, dto: any) => {
      order.push('createTwin');
      return { id: NEW_TWIN_ID, status: freshTwinStatus ?? LedgerEntryStatus.POSTED, ...dto };
    }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const periodGuard = {
    assertWritable: jest.fn().mockImplementation(async () => {
      order.push('guard');
      if (guardRejects) throw guardRejects;
    }),
  };

  const svc = new StandaloneCrewCashService(prisma as any, staffLedger as any, audit as any, periodGuard as any);
  return { svc, prisma, tx, staffLedger, audit, periodGuard, order, getRow: () => current };
}

function expectNothingMutated(m: ReturnType<typeof makeService>) {
  expect(m.prisma.$transaction).not.toHaveBeenCalled();
  expect(m.tx.standaloneCrewCashExpense.updateMany).not.toHaveBeenCalled();
  expect(m.tx.standaloneCrewCashExpense.update).not.toHaveBeenCalled();
  expect(m.staffLedger.voidEntryTx).not.toHaveBeenCalled();
  expect(m.staffLedger.reverseTx).not.toHaveBeenCalled();
  expect(m.staffLedger.createTx).not.toHaveBeenCalled();
  expect(m.audit.log).not.toHaveBeenCalled();
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('StandaloneCrewCashService', () => {
  // ── update() ─────────────────────────────────────────────────────────────

  describe('update()', () => {
    const reason = 'Wrong amount typed at the counter';

    it('happy path: CAS first, voids the old twin, creates a fresh twin, repoints + bumps the row, audits only changed fields', async () => {
      const m = makeService();
      const dto = { version: 3, amount: 250, date: '2026-09-12', reason };

      const result = await m.svc.update(managerUser, ROW_ID, dto);

      // ordering: guard, then CAS, void old twin, create fresh twin, rewrite row
      expect(m.order).toEqual(['guard', 'cas', 'voidTwin', 'createTwin', 'rowUpdate']);

      // same single transaction
      expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);

      // CAS on the row's version
      expect(m.tx.standaloneCrewCashExpense.updateMany).toHaveBeenCalledWith({
        where: { id: ROW_ID, vendorId: VENDOR_ID, status: StandaloneCrewCashStatus.ACTIVE, version: 3 },
        data: { version: { increment: 1 } },
      });

      // old twin voided with its LIVE version, reason, and the creator-check bypass
      expect(m.staffLedger.voidEntryTx).toHaveBeenCalledWith(
        m.tx,
        managerUser,
        OLD_TWIN_ID,
        { version: 7, reason },
        { skipCreatorCheck: true },
      );

      // fresh twin: negative amount, new date, same description format as create
      expect(m.staffLedger.createTx).toHaveBeenCalledWith(m.tx, managerUser, {
        userId: EMPLOYEE_ID,
        category: 'CREW_CASH',
        amount: -250,
        effectiveDate: new Date('2026-09-12').toISOString(),
        description: 'Crew Cash (no sheet) — TEA',
      });

      // row rewritten + repointed
      const updateArg = m.tx.standaloneCrewCashExpense.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: ROW_ID });
      expect(updateArg.data).toMatchObject({
        employeeId: EMPLOYEE_ID,
        category: CrewCashCategory.TEA,
        amount: 250,
        date: new Date('2026-09-12'),
        notes: null,
        staffLedgerEntryId: NEW_TWIN_ID,
        editCount: { increment: 1 },
        updatedById: managerUser.userId,
      });
      expect(updateArg.data.lastEditedAt).toBeInstanceOf(Date);

      // returned row reflects the edit (version 3 → 4 via the CAS, editCount 0 → 1)
      expect(result).toMatchObject({ amount: 250, staffLedgerEntryId: NEW_TWIN_ID, version: 4, editCount: 1 });

      // audit: only changed fields (+ twin ids), numbers + ISO dates, reason at changes.reason
      expect(m.audit.log).toHaveBeenCalledTimes(1);
      expect(m.audit.log).toHaveBeenCalledWith({
        vendorId: VENDOR_ID,
        userId: managerUser.userId,
        userName: 'Manager',
        action: 'UPDATED',
        entity: 'StandaloneCrewCashExpense',
        entityId: ROW_ID,
        changes: {
          before: { amount: 100, date: baseRow.date.toISOString(), ledgerTwinId: OLD_TWIN_ID },
          after: { amount: 250, date: new Date('2026-09-12').toISOString(), ledgerTwinId: NEW_TWIN_ID },
          reason,
        },
      });
    });

    it('employee reassignment moves the fresh twin to the new employee (and validates tenancy)', async () => {
      const m = makeService();
      await m.svc.update(managerUser, ROW_ID, { version: 3, employeeId: OTHER_EMPLOYEE_ID, reason });

      expect(m.prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: OTHER_EMPLOYEE_ID, vendorId: VENDOR_ID },
        select: { id: true },
      });
      expect(m.staffLedger.createTx).toHaveBeenCalledWith(
        m.tx,
        managerUser,
        expect.objectContaining({ userId: OTHER_EMPLOYEE_ID, amount: -100 }),
      );
      expect(m.tx.standaloneCrewCashExpense.update.mock.calls[0][0].data.employeeId).toBe(OTHER_EMPLOYEE_ID);
      expect(m.audit.log.mock.calls[0][0].changes).toEqual({
        before: { employeeId: EMPLOYEE_ID, ledgerTwinId: OLD_TWIN_ID },
        after: { employeeId: OTHER_EMPLOYEE_ID, ledgerTwinId: NEW_TWIN_ID },
        reason,
      });
    });

    it('notes-only edit keeps the stored date and puts the notes into the twin description', async () => {
      const m = makeService();
      await m.svc.update(managerUser, ROW_ID, { version: 3, notes: 'lunch for loaders', reason });

      const createDto = m.staffLedger.createTx.mock.calls[0][2];
      expect(createDto.description).toBe('Crew Cash (no sheet) — TEA: lunch for loaders');
      expect(createDto.effectiveDate).toBe(baseRow.date.toISOString());
      expect(m.tx.standaloneCrewCashExpense.update.mock.calls[0][0].data.date).toBe(baseRow.date);
      expect(m.audit.log.mock.calls[0][0].changes.before).toEqual({ notes: null, ledgerTwinId: OLD_TWIN_ID });
      expect(m.audit.log.mock.calls[0][0].changes.after).toEqual({
        notes: 'lunch for loaders',
        ledgerTwinId: NEW_TWIN_ID,
      });
    });

    it('calls the period guard with BOTH the old and the new date, before mutating', async () => {
      const m = makeService();
      await m.svc.update(managerUser, ROW_ID, { version: 3, date: '2026-09-12', reason });

      expect(m.periodGuard.assertWritable).toHaveBeenCalledTimes(1);
      const [vendorId, dates] = m.periodGuard.assertWritable.mock.calls[0];
      expect(vendorId).toBe(VENDOR_ID);
      expect(dates).toEqual([baseRow.date, new Date('2026-09-12')]);
      expect(m.order.indexOf('guard')).toBeLessThan(m.order.indexOf('cas'));
    });

    it('a guard rejection propagates and nothing is mutated', async () => {
      const m = makeService({ guardRejects: new BadRequestException('period closed') });
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, amount: 5, reason })).rejects.toThrow('period closed');
      expectNothingMutated(m);
    });

    it('the fresh twin may legitimately be PENDING (approval gate) — the row is still updated', async () => {
      const m = makeService({ freshTwinStatus: LedgerEntryStatus.PENDING });
      const result = await m.svc.update(managerUser, ROW_ID, { version: 3, amount: 900000, reason });

      expect(m.staffLedger.createTx).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ amount: 900000, staffLedgerEntryId: NEW_TWIN_ID });
    });

    it('BLOCKS the edit when the twin is rolled into a locked payroll period — explanatory message, nothing mutated', async () => {
      const m = makeService({ twin: lockedTwin });
      const call = m.svc.update(managerUser, ROW_ID, { version: 3, amount: 200, reason });

      await expect(call).rejects.toThrow(BadRequestException);
      await expect(call).rejects.toThrow(STANDALONE_CREW_CASH_LOCKED_REASON);
      expectNothingMutated(m);
    });

    it('rejects when the twin is VOIDED (inconsistent) — 400, nothing mutated', async () => {
      const m = makeService({ twin: voidedTwin });
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, amount: 200, reason })).rejects.toThrow(
        BadRequestException,
      );
      expectNothingMutated(m);
    });

    it('rejects editing a VOIDED row with 400', async () => {
      const m = makeService({ row: { ...baseRow, status: StandaloneCrewCashStatus.VOIDED } });
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, amount: 200, reason })).rejects.toThrow(
        BadRequestException,
      );
      expectNothingMutated(m);
    });

    it('404 when the row is not this vendor\'s', async () => {
      const m = makeService();
      m.prisma.standaloneCrewCashExpense.findFirst.mockResolvedValue(null);
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, amount: 200, reason })).rejects.toThrow(
        NotFoundException,
      );
      expect(m.prisma.standaloneCrewCashExpense.findFirst).toHaveBeenCalledWith({
        where: { id: ROW_ID, vendorId: VENDOR_ID },
      });
      expectNothingMutated(m);
    });

    it('rejects a request that changes nothing (400)', async () => {
      const m = makeService();
      await expect(
        m.svc.update(managerUser, ROW_ID, {
          version: 3,
          amount: 100, // same
          category: CrewCashCategory.TEA, // same
          employeeId: EMPLOYEE_ID, // same
          date: '2026-09-10', // same vendor day as the stored timestamp
          reason,
        }),
      ).rejects.toThrow(BadRequestException);
      expectNothingMutated(m);
    });

    it('treats blank notes on a row with no notes as unchanged', async () => {
      const m = makeService();
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, notes: '   ', reason })).rejects.toThrow(
        BadRequestException,
      );
      expectNothingMutated(m);
    });

    it('rejects a future date (400)', async () => {
      const m = makeService();
      await expect(m.svc.update(managerUser, ROW_ID, { version: 3, date: '2999-01-01', reason })).rejects.toThrow(
        BadRequestException,
      );
      expectNothingMutated(m);
    });

    it('404 when the new employee belongs to another vendor / does not exist', async () => {
      const m = makeService({ employeeExists: false });
      await expect(
        m.svc.update(managerUser, ROW_ID, { version: 3, employeeId: OTHER_EMPLOYEE_ID, reason }),
      ).rejects.toThrow(NotFoundException);
      expectNothingMutated(m);
    });

    it('stale version → 409 and the CAS runs FIRST: no twin is voided or created', async () => {
      const m = makeService({ casCount: 0 });
      await expect(m.svc.update(managerUser, ROW_ID, { version: 1, amount: 200, reason })).rejects.toThrow(
        ConflictException,
      );

      expect(m.order).toEqual(['guard', 'cas']);
      expect(m.staffLedger.voidEntryTx).not.toHaveBeenCalled();
      expect(m.staffLedger.createTx).not.toHaveBeenCalled();
      expect(m.tx.standaloneCrewCashExpense.update).not.toHaveBeenCalled();
      expect(m.audit.log).not.toHaveBeenCalled();
    });
  });

  // ── void() ───────────────────────────────────────────────────────────────

  describe('void()', () => {
    const reason = 'Recorded against wrong person entirely';

    it('voids an unlocked twin with the creator-check bypass for a non-creator, guards the row date, and writes changes.reason (+ legacy after.voidReason)', async () => {
      const m = makeService();
      // status-only CAS models the void claim
      await m.svc.void(managerUser, ROW_ID, { reason });

      expect(m.periodGuard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [baseRow.date], expect.anything());
      expect(m.staffLedger.voidEntryTx).toHaveBeenCalledWith(
        m.tx,
        managerUser,
        OLD_TWIN_ID,
        { version: 7, reason },
        { skipCreatorCheck: true },
      );
      expect(m.staffLedger.reverseTx).not.toHaveBeenCalled();
      expect(m.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOIDED',
          entity: 'StandaloneCrewCashExpense',
          changes: {
            before: { status: StandaloneCrewCashStatus.ACTIVE },
            after: { status: expect.anything(), voidReason: reason },
            reason,
          },
        }),
      );
    });

    it('a twin already rolled into a locked period is REVERSED (no creator gate involved)', async () => {
      const m = makeService({ twin: lockedTwin });
      m.tx.staffLedgerEntry.findUniqueOrThrow.mockResolvedValue(lockedTwin);
      await m.svc.void(managerUser, ROW_ID, { reason });

      expect(m.staffLedger.reverseTx).toHaveBeenCalledWith(m.tx, managerUser, OLD_TWIN_ID, { version: 7, reason });
      expect(m.staffLedger.voidEntryTx).not.toHaveBeenCalled();
    });

    it('a period-guard rejection blocks the void', async () => {
      const m = makeService({ guardRejects: new BadRequestException('period closed') });
      await expect(m.svc.void(managerUser, ROW_ID, { reason })).rejects.toThrow('period closed');
      expectNothingMutated(m);
    });

    it('rejects voiding an already-voided row', async () => {
      const m = makeService({ row: { ...baseRow, status: StandaloneCrewCashStatus.VOIDED } });
      await expect(m.svc.void(managerUser, ROW_ID, { reason })).rejects.toThrow(BadRequestException);
      expectNothingMutated(m);
    });
  });

  // ── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    const base = { employeeId: EMPLOYEE_ID, category: CrewCashCategory.TEA, amount: 100 };

    it('rejects a future date (400) before touching anything', async () => {
      const m = makeService();
      await expect(m.svc.create(managerUser, { ...base, date: '2999-01-01' })).rejects.toThrow(BadRequestException);
      expect(m.prisma.$transaction).not.toHaveBeenCalled();
      expect(m.staffLedger.createTx).not.toHaveBeenCalled();
    });

    it('calls the period guard with the entry date and creates the twin in-tx', async () => {
      const m = makeService();
      (m.tx.standaloneCrewCashExpense as any).create = jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'new-row',
        ...data,
      }));

      await m.svc.create(managerUser, { ...base, date: '2026-09-10', notes: 'tea' });

      expect(m.periodGuard.assertWritable).toHaveBeenCalledWith(
        VENDOR_ID,
        [new Date('2026-09-10')],
        expect.anything(),
      );
      expect(m.staffLedger.createTx).toHaveBeenCalledWith(
        m.tx,
        managerUser,
        expect.objectContaining({ userId: EMPLOYEE_ID, amount: -100, description: 'Crew Cash (no sheet) — TEA: tea' }),
      );
    });

    it('404 for an employee outside the vendor', async () => {
      const m = makeService({ employeeExists: false });
      await expect(m.svc.create(managerUser, base)).rejects.toThrow(NotFoundException);
    });
  });
});
