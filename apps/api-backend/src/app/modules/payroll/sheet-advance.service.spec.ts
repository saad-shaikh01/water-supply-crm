import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LedgerEntryStatus, SheetAdvanceStatus, StaffLedgerCategory } from '@prisma/client';
import { SheetAdvanceService } from './sheet-advance.service';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const SHEET_ID = 'sheet-001';
const EMPLOYEE_ID = 'employee-001';
const OTHER_EMPLOYEE_ID = 'employee-002';
const ADVANCE_ID = 'advance-001';
const TWIN_ID = 'twin-001';

const managerUser = { userId: 'manager-001', vendorId: VENDOR_ID, role: 'STAFF', name: 'Manager' } as any;
const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin' } as any;
const otherUser = { userId: 'other-001', vendorId: VENDOR_ID, role: 'STAFF', name: 'Other' } as any;

const sheetOpen = { id: SHEET_ID, date: new Date('2026-10-01'), isClosed: false };
const sheetClosed = { ...sheetOpen, isClosed: true };

const baseRow = {
  id: ADVANCE_ID,
  vendorId: VENDOR_ID,
  dailySheetId: SHEET_ID,
  employeeId: EMPLOYEE_ID,
  amount: 500,
  notes: null as string | null,
  date: sheetOpen.date,
  status: SheetAdvanceStatus.ACTIVE,
  staffLedgerEntryId: TWIN_ID,
  createdById: managerUser.userId,
  version: 1,
  editCount: 0,
};
const rowOn = (sheet: { isClosed: boolean; date: Date }, over: Record<string, unknown> = {}) => ({
  ...baseRow,
  ...over,
  dailySheet: { isClosed: sheet.isClosed, date: sheet.date },
});

const twinUnlocked = {
  id: TWIN_ID,
  vendorId: VENDOR_ID,
  userId: EMPLOYEE_ID,
  category: StaffLedgerCategory.ADVANCE,
  amount: -500,
  status: LedgerEntryStatus.POSTED,
  payrollEntryId: null as string | null,
  version: 3,
};
const twinLocked = { ...twinUnlocked, payrollEntryId: 'payroll-entry-1' };

/** A closed-sheet reload as SHEET_CASH_RELOAD_INCLUDE returns it, AFTER the change. */
const closedReload = {
  id: SHEET_ID,
  isClosed: true,
  cashCollected: 1000,
  cashExpected: 1000,
  postCloseCrewCashCorrectionCount: 1,
  items: [],
  expenses: [],
  crewCashDistributions: [],
  sheetAdvances: [{ amount: 500 }],
  loads: [],
};

// ─── factory ──────────────────────────────────────────────────────────────────

function makeService(
  opts: {
    sheet?: any;
    row?: any;
    twin?: any;
    employeeExists?: boolean;
    can?: boolean | ((userId: string, perm: string) => boolean);
    activeTrip?: { id: string } | null;
    lastTrip?: { id: string } | null;
    lockedPayrollPeriod?: boolean;
    sheetIsClosedInTx?: boolean;
    casCount?: number;
  } = {},
) {
  const {
    sheet = sheetOpen,
    row = rowOn(sheetOpen),
    twin = twinUnlocked,
    employeeExists = true,
    can = true,
    activeTrip = null,
    lastTrip = null,
    lockedPayrollPeriod = false,
    sheetIsClosedInTx,
    casCount = 1,
  } = opts;

  const tx = {
    sheetAdvance: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: ADVANCE_ID,
        version: 1,
        status: SheetAdvanceStatus.ACTIVE,
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: casCount }),
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...baseRow, status: SheetAdvanceStatus.ACTIVE }),
    },
    staffLedgerEntry: {
      findFirst: jest.fn().mockResolvedValue({ ...twin }),
    },
    payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPayrollPeriod ? { id: 'period-locked' } : null) },
    dailySheet: {
      findUnique: jest.fn().mockResolvedValue(closedReload),
      update: jest.fn().mockResolvedValue({ id: SHEET_ID }),
    },
  };
  // syncClosedSheet() first asks `{ select: { isClosed } }`, then reloads with the include.
  tx.dailySheet.findUnique.mockImplementation(async (args: any) =>
    args?.select?.isClosed ? { isClosed: sheetIsClosedInTx ?? !!(sheet?.isClosed || row?.dailySheet?.isClosed) } : closedReload,
  );

  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    dailySheet: { findFirst: jest.fn().mockResolvedValue(sheet) },
    user: { findFirst: jest.fn().mockResolvedValue(employeeExists ? { id: EMPLOYEE_ID } : null) },
    dailySheetLoad: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => (where.endedAt === null ? activeTrip : lastTrip)),
    },
    sheetAdvance: { findFirst: jest.fn().mockResolvedValue(row) },
  };
  const staffLedger = {
    createTx: jest.fn().mockImplementation(async (_tx: any, _user: any, dto: any) => ({ id: 'fresh-twin-1', ...dto })),
    voidEntryTx: jest.fn().mockResolvedValue(undefined),
    reverseTx: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const permissions = {
    can: jest.fn().mockImplementation(async (userId: string, perm: string) =>
      typeof can === 'function' ? can(userId, perm) : can,
    ),
  };
  const vanCashLedger = { handlePostCloseCorrection: jest.fn().mockResolvedValue(null) };

  const svc = new SheetAdvanceService(
    prisma as any,
    staffLedger as any,
    audit as any,
    permissions as any,
    vanCashLedger as any,
  );
  return { svc, prisma, tx, staffLedger, audit, permissions, vanCashLedger };
}

const createDto = { employeeId: EMPLOYEE_ID, amount: 500 };

// ─── tests ────────────────────────────────────────────────────────────────────

describe('SheetAdvanceService', () => {
  describe('create()', () => {
    it('throws NotFoundException when the sheet is not this vendor’s', async () => {
      const { svc } = makeService({ sheet: null });
      await expect(svc.create(managerUser, SHEET_ID, createDto)).rejects.toThrow(NotFoundException);
    });

    it('rejects an unknown / inactive / foreign employee', async () => {
      const { svc, prisma } = makeService({ employeeExists: false });
      await expect(svc.create(managerUser, SHEET_ID, createDto)).rejects.toThrow(BadRequestException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: EMPLOYEE_ID, vendorId: VENDOR_ID, isActive: true } }),
      );
    });

    it('posts a NEGATIVE ADVANCE payroll twin (skipping the cash-ledger period guard) and links the row to it', async () => {
      const { svc, staffLedger, tx } = makeService();
      await svc.create(managerUser, SHEET_ID, { ...createDto, notes: ' for rent ' });

      expect(staffLedger.createTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        expect.objectContaining({
          userId: EMPLOYEE_ID,
          category: StaffLedgerCategory.ADVANCE,
          amount: -500,
          effectiveDate: sheetOpen.date.toISOString(),
          description: expect.stringContaining('for rent'),
        }),
        { skipPeriodGuard: true },
      );
      expect(tx.sheetAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dailySheetId: SHEET_ID,
            employeeId: EMPLOYEE_ID,
            amount: 500,
            notes: 'for rent',
            staffLedgerEntryId: 'fresh-twin-1',
            createdById: managerUser.userId,
            date: sheetOpen.date,
          }),
        }),
      );
    });

    it('attributes the row to the ACTIVE trip on an open sheet', async () => {
      const { svc, tx } = makeService({ activeTrip: { id: 'trip-1' } });
      await svc.create(managerUser, SHEET_ID, createDto);
      expect(tx.sheetAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dailySheetLoadId: 'trip-1' }) }),
      );
    });

    it('never touches the marker or the Cash Ledger on an OPEN sheet', async () => {
      const { svc, tx, vanCashLedger } = makeService();
      await svc.create(managerUser, SHEET_ID, createDto);
      expect(tx.dailySheet.update).not.toHaveBeenCalled();
      expect(vanCashLedger.handlePostCloseCorrection).not.toHaveBeenCalled();
    });

    it('dates the twin TODAY when the sheet date sits in a LOCKED/PAID payroll period', async () => {
      const { svc, staffLedger } = makeService({ lockedPayrollPeriod: true });
      await svc.create(managerUser, SHEET_ID, createDto);
      const dto = staffLedger.createTx.mock.calls[0][2];
      expect(new Date(dto.effectiveDate).getTime()).toBeGreaterThan(sheetOpen.date.getTime());
    });

    describe('on an already-CLOSED sheet', () => {
      const closedDto = { ...createDto, reason: 'driver forgot to log it' };

      it('rejects without a reason', async () => {
        const { svc } = makeService({ sheet: sheetClosed });
        await expect(svc.create(adminUser, SHEET_ID, createDto)).rejects.toThrow(BadRequestException);
        await expect(svc.create(adminUser, SHEET_ID, { ...createDto, reason: ' ' })).rejects.toThrow(BadRequestException);
      });

      it('rejects a caller without daily_sheets:edit_closed_expense', async () => {
        const { svc, permissions } = makeService({ sheet: sheetClosed, can: false });
        await expect(svc.create(managerUser, SHEET_ID, closedDto)).rejects.toThrow(ForbiddenException);
        expect(permissions.can).toHaveBeenCalledWith(managerUser.userId, 'daily_sheets:edit_closed_expense');
      });

      it('attributes the row to the last-ended trip', async () => {
        const { svc, tx } = makeService({ sheet: sheetClosed, lastTrip: { id: 'last-trip' } });
        await svc.create(adminUser, SHEET_ID, closedDto);
        expect(tx.sheetAdvance.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ dailySheetLoadId: 'last-trip' }) }),
        );
      });

      it('bumps the shared marker and corrects the Cash Ledger handover in the SAME transaction', async () => {
        const { svc, tx, vanCashLedger, prisma } = makeService({ sheet: sheetClosed });
        await svc.create(adminUser, SHEET_ID, closedDto);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.dailySheet.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: SHEET_ID }, data: { postCloseCrewCashCorrectionCount: { increment: 1 } } }),
        );
        expect(vanCashLedger.handlePostCloseCorrection).toHaveBeenCalledTimes(1);
        const [passedTx, vendorId, sheetId, cashExpected] = vanCashLedger.handlePostCloseCorrection.mock.calls[0];
        expect(passedTx).toBe(tx);
        expect(vendorId).toBe(VENDOR_ID);
        expect(sheetId).toBe(SHEET_ID);
        // live recompute: 1000 recorded cash? (no items in the fixture) → floored net; just prove it's a number from resolveSheetCash
        expect(typeof cashExpected).toBe('number');
      });

      it('writes an audit row carrying the reason', async () => {
        const { svc, audit } = makeService({ sheet: sheetClosed });
        await svc.create(adminUser, SHEET_ID, closedDto);
        expect(audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            entity: 'SheetAdvance',
            action: 'CLOSED_SHEET_ADVANCE_ADDED',
            changes: expect.objectContaining({ reason: 'driver forgot to log it' }),
          }),
        );
      });
    });
  });

  describe('update()', () => {
    const updateDto = { version: 1, amount: 700 };

    it('404s on an unknown advance', async () => {
      const { svc } = makeService({ row: null });
      await expect(svc.update(managerUser, ADVANCE_ID, updateDto)).rejects.toThrow(NotFoundException);
    });

    it('rejects editing a deleted advance', async () => {
      const { svc } = makeService({ row: rowOn(sheetOpen, { status: SheetAdvanceStatus.VOIDED }) });
      await expect(svc.update(managerUser, ADVANCE_ID, updateDto)).rejects.toThrow(BadRequestException);
    });

    it('lets the creator edit without payroll:ledger_void, but rejects a non-creator without it', async () => {
      const a = makeService({ can: false });
      await expect(a.svc.update(managerUser, ADVANCE_ID, updateDto)).resolves.toBeDefined();

      const b = makeService({ can: false });
      await expect(b.svc.update(otherUser, ADVANCE_ID, updateDto)).rejects.toThrow(ForbiddenException);
    });

    it('lets a payroll:ledger_void holder edit an advance they did not create', async () => {
      const { svc, permissions } = makeService({ can: (_u, p) => p === 'payroll:ledger_void' });
      await expect(svc.update(adminUser, ADVANCE_ID, updateDto)).resolves.toBeDefined();
      expect(permissions.can).toHaveBeenCalledWith(adminUser.userId, 'payroll:ledger_void');
    });

    it('rejects an edit that changes nothing', async () => {
      const { svc } = makeService();
      await expect(svc.update(managerUser, ADVANCE_ID, { version: 1, amount: 500 })).rejects.toThrow(BadRequestException);
    });

    it('rejects when the optimistic-concurrency version is stale — before any twin is touched', async () => {
      const { svc, staffLedger } = makeService({ casCount: 0 });
      await expect(svc.update(managerUser, ADVANCE_ID, updateDto)).rejects.toThrow(ConflictException);
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
    });

    it('BLOCKS the edit once the twin is rolled into a locked payroll period', async () => {
      const { svc, staffLedger } = makeService({ twin: twinLocked });
      await expect(svc.update(managerUser, ADVANCE_ID, updateDto)).rejects.toThrow(/locked payroll period/);
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
    });

    it('voids the old twin (skip flags), posts a fresh negative twin and repoints the row', async () => {
      const { svc, staffLedger, tx } = makeService();
      await svc.update(managerUser, ADVANCE_ID, updateDto);

      expect(staffLedger.voidEntryTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        TWIN_ID,
        { version: twinUnlocked.version, reason: expect.any(String) },
        { skipCreatorCheck: true, skipPeriodGuard: true, skipSheetAdvanceGuard: true },
      );
      expect(staffLedger.createTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        expect.objectContaining({ category: StaffLedgerCategory.ADVANCE, amount: -700, userId: EMPLOYEE_ID }),
        { skipPeriodGuard: true },
      );
      expect(tx.sheetAdvance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ADVANCE_ID },
          data: expect.objectContaining({
            amount: 700,
            staffLedgerEntryId: 'fresh-twin-1',
            editCount: { increment: 1 },
          }),
        }),
      );
      // order: CAS first, then void, then fresh twin
      const cas = tx.sheetAdvance.updateMany.mock.invocationCallOrder[0];
      const voided = staffLedger.voidEntryTx.mock.invocationCallOrder[0];
      const fresh = staffLedger.createTx.mock.invocationCallOrder[0];
      expect(cas).toBeLessThan(voided);
      expect(voided).toBeLessThan(fresh);
    });

    it('re-targets the new employee when employeeId changes (and validates them)', async () => {
      const { svc, staffLedger, prisma } = makeService();
      await svc.update(managerUser, ADVANCE_ID, { version: 1, employeeId: OTHER_EMPLOYEE_ID });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OTHER_EMPLOYEE_ID, vendorId: VENDOR_ID, isActive: true } }),
      );
      expect(staffLedger.createTx.mock.calls[0][2]).toEqual(expect.objectContaining({ userId: OTHER_EMPLOYEE_ID }));
    });

    it('does not touch the Cash Ledger for an edit on an OPEN sheet', async () => {
      const { svc, vanCashLedger, tx } = makeService();
      await svc.update(managerUser, ADVANCE_ID, updateDto);
      expect(vanCashLedger.handlePostCloseCorrection).not.toHaveBeenCalled();
      expect(tx.dailySheet.update).not.toHaveBeenCalled();
    });

    describe('on a CLOSED sheet', () => {
      const closedRow = rowOn(sheetClosed);

      it('requires a reason and daily_sheets:edit_closed_expense', async () => {
        const noReason = makeService({ row: closedRow, sheet: sheetClosed });
        await expect(noReason.svc.update(managerUser, ADVANCE_ID, updateDto)).rejects.toThrow(BadRequestException);

        const noPerm = makeService({ row: closedRow, sheet: sheetClosed, can: false });
        await expect(noPerm.svc.update(managerUser, ADVANCE_ID, { ...updateDto, reason: 'wrong amount' })).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('bumps the marker and corrects the handover chain', async () => {
        const { svc, tx, vanCashLedger } = makeService({ row: closedRow, sheet: sheetClosed });
        await svc.update(managerUser, ADVANCE_ID, { ...updateDto, reason: 'wrong amount' });
        expect(tx.dailySheet.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { postCloseCrewCashCorrectionCount: { increment: 1 } } }),
        );
        expect(vanCashLedger.handlePostCloseCorrection).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('remove()', () => {
    it('404s on an unknown advance and rejects an already-deleted one', async () => {
      await expect(makeService({ row: null }).svc.remove(managerUser, ADVANCE_ID, {})).rejects.toThrow(NotFoundException);
      await expect(
        makeService({ row: rowOn(sheetOpen, { status: SheetAdvanceStatus.VOIDED }) }).svc.remove(managerUser, ADVANCE_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('is creator-or-payroll:ledger_void only', async () => {
      const { svc } = makeService({ can: false });
      await expect(svc.remove(otherUser, ADVANCE_ID, {})).rejects.toThrow(ForbiddenException);
      await expect(makeService({ can: false }).svc.remove(managerUser, ADVANCE_ID, {})).resolves.toBeDefined();
    });

    it('is a SOFT void — the row is kept (status VOIDED), never deleted', async () => {
      const { svc, tx } = makeService();
      await svc.remove(managerUser, ADVANCE_ID, {});
      expect(tx.sheetAdvance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ADVANCE_ID, vendorId: VENDOR_ID, status: SheetAdvanceStatus.ACTIVE },
          data: expect.objectContaining({ status: SheetAdvanceStatus.VOIDED, voidedById: managerUser.userId }),
        }),
      );
      expect((tx.sheetAdvance as any).delete).toBeUndefined();
    });

    it('VOIDS an unlocked twin (skip flags)', async () => {
      const { svc, staffLedger, tx } = makeService();
      await svc.remove(managerUser, ADVANCE_ID, { reason: 'entered twice' });
      expect(staffLedger.voidEntryTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        TWIN_ID,
        { version: twinUnlocked.version, reason: 'entered twice' },
        { skipCreatorCheck: true, skipPeriodGuard: true, skipSheetAdvanceGuard: true },
      );
      expect(staffLedger.reverseTx).not.toHaveBeenCalled();
    });

    it('REVERSES a twin that payroll already locked (reversal flows into the current period)', async () => {
      const { svc, staffLedger, tx } = makeService({ twin: twinLocked });
      await svc.remove(managerUser, ADVANCE_ID, { reason: 'entered twice' });
      expect(staffLedger.reverseTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        TWIN_ID,
        { version: twinLocked.version, reason: 'entered twice' },
        { skipSheetAdvanceGuard: true },
      );
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
    });

    it('leaves an already-VOIDED twin alone', async () => {
      const { svc, staffLedger } = makeService({ twin: { ...twinUnlocked, status: LedgerEntryStatus.VOIDED } });
      await svc.remove(managerUser, ADVANCE_ID, {});
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
      expect(staffLedger.reverseTx).not.toHaveBeenCalled();
    });

    it('fails (rolling the transaction back) when a concurrent delete already claimed the row', async () => {
      const { svc, staffLedger } = makeService({ casCount: 0 });
      await expect(svc.remove(managerUser, ADVANCE_ID, {})).rejects.toThrow(BadRequestException);
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
    });

    describe('on a CLOSED sheet', () => {
      const closedRow = rowOn(sheetClosed);

      it('requires a reason and daily_sheets:edit_closed_expense', async () => {
        await expect(makeService({ row: closedRow }).svc.remove(managerUser, ADVANCE_ID, {})).rejects.toThrow(BadRequestException);
        await expect(
          makeService({ row: closedRow, can: false }).svc.remove(managerUser, ADVANCE_ID, { reason: 'duplicate' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('bumps the marker and corrects the handover chain (cash goes back into the hand-in)', async () => {
        const { svc, tx, vanCashLedger } = makeService({ row: closedRow });
        await svc.remove(managerUser, ADVANCE_ID, { reason: 'duplicate' });
        expect(tx.dailySheet.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { postCloseCrewCashCorrectionCount: { increment: 1 } } }),
        );
        expect(vanCashLedger.handlePostCloseCorrection).toHaveBeenCalledTimes(1);
      });
    });
  });
});
