import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';
import { AttendanceSource, AttendanceStatus, CrewRole, DailySheetKind, StaffLedgerCategory } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const DRIVER_ID = 'driver-001';
const LOADER_ID = 'loader-001';
const SALESMAN_ID = 'salesman-001';
const SHEET_ID = 'sheet-001';
const SHEET_DATE = new Date('2026-08-05T09:30:00.000Z');
const DAY = new Date('2026-08-05T00:00:00.000Z');

const managerUser = { userId: 'manager-001', vendorId: VENDOR_ID, role: 'STAFF' } as any;

const routeSheet: any = {
  id: SHEET_ID,
  kind: DailySheetKind.ROUTE,
  date: SHEET_DATE,
  driverId: DRIVER_ID,
  crew: [
    { userId: LOADER_ID, role: CrewRole.LOADER },
    { userId: SALESMAN_ID, role: CrewRole.SALESMAN },
  ],
};

// ─── mock factory ────────────────────────────────────────────────────────────

function makeTx(overrides: any = {}) {
  return {
    staffAttendance: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'att-new', version: 1, ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'att-upd', ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...(overrides.staffAttendance ?? {}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: DRIVER_ID, isSystem: false },
        { id: LOADER_ID, isSystem: false },
        { id: SALESMAN_ID, isSystem: false },
      ]),
      ...(overrides.user ?? {}),
    },
  };
}

function makeService(opts: { tx?: any; canViewAll?: boolean; employeeExists?: boolean } = {}) {
  const tx = opts.tx ?? makeTx();
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: { findFirst: jest.fn().mockResolvedValue(opts.employeeExists === false ? null : { id: DRIVER_ID }) },
    payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'period-001', startDate: DAY, endDate: DAY }) },
    dailySheet: { findFirst: jest.fn().mockResolvedValue({ id: SHEET_ID }) },
    staffAttendance: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const permissions = { can: jest.fn().mockResolvedValue(opts.canViewAll ?? false) };
  const staffLedger = {
    createTx: jest.fn().mockResolvedValue({ id: 'ledger-entry-001', status: 'POSTED' }),
  };
  const svc = new StaffAttendanceService(prisma as any, permissions as any, staffLedger as any);
  return { svc, prisma, tx, permissions, staffLedger };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('StaffAttendanceService', () => {
  describe('captureForConfirmedCrew()', () => {
    it('creates a PRESENT / CREW_CONFIRM row for the driver and every crew member', async () => {
      const { svc, tx } = makeService();
      const res = await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(res.captured).toBe(3);
      expect(tx.staffAttendance.create).toHaveBeenCalledTimes(3);
      for (const call of tx.staffAttendance.create.mock.calls) {
        expect(call[0].data).toEqual(
          expect.objectContaining({
            vendorId: VENDOR_ID,
            date: DAY,
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.CREW_CONFIRM,
            dailySheetId: SHEET_ID,
            markedById: managerUser.userId,
          }),
        );
      }
      const createdIds = tx.staffAttendance.create.mock.calls.map((c: any) => c[0].data.userId);
      expect(new Set(createdIds)).toEqual(new Set([DRIVER_ID, LOADER_ID, SALESMAN_ID]));
    });

    it('is idempotent — a second run with the rows already present creates nothing and does not throw', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'att-x',
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.CREW_CONFIRM,
            leaveLedgerEntryId: null,
            dailySheetId: SHEET_ID,
          }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      const res = await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(res.captured).toBe(0);
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
      expect(tx.staffAttendance.update).not.toHaveBeenCalled();
    });

    it('never overwrites a MANUAL row', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'att-manual',
            source: AttendanceSource.MANUAL,
            leaveLedgerEntryId: null,
            dailySheetId: null,
          }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
      expect(tx.staffAttendance.update).not.toHaveBeenCalled();
    });

    it('never overwrites a row already bridged to a ledger entry', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'att-bridged',
            source: AttendanceSource.CREW_CONFIRM,
            leaveLedgerEntryId: 'ledger-entry-001',
            dailySheetId: 'other-sheet',
          }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
          update: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(tx.staffAttendance.update).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
    });

    it('re-points an existing auto PRESENT row that belongs to a different sheet for the same day', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'att-other-sheet',
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.CREW_CONFIRM,
            leaveLedgerEntryId: null,
            dailySheetId: 'a-different-sheet',
          }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const { svc } = makeService({ tx });
      await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(tx.staffAttendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dailySheetId: SHEET_ID }) }),
      );
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
    });

    it('reconciles — deletes stale auto rows for users no longer on the sheet (with no ledger bridge)', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([{ id: 'stale-1' }, { id: 'stale-2' }]),
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          create: jest.fn().mockResolvedValue({ id: 'x' }),
          update: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      const res = await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(tx.staffAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dailySheetId: SHEET_ID,
            source: AttendanceSource.CREW_CONFIRM,
            leaveLedgerEntryId: null,
          }),
        }),
      );
      expect(tx.staffAttendance.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['stale-1', 'stale-2'] } } });
      expect(res.reconciled).toBe(2);
    });

    it('short-circuits on a WALK_IN sheet — no queries, no writes', async () => {
      const { svc, tx } = makeService();
      const res = await svc.captureForConfirmedCrew(
        tx as any,
        VENDOR_ID,
        { ...routeSheet, kind: DailySheetKind.WALK_IN },
        managerUser.userId,
      );
      expect(res).toEqual({ captured: 0, reconciled: 0 });
      expect(tx.user.findMany).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
    });

    it('skips a sentinel isSystem user in the roster', async () => {
      const tx = makeTx({
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: DRIVER_ID, isSystem: true },
            { id: LOADER_ID, isSystem: false },
            { id: SALESMAN_ID, isSystem: false },
          ]),
        },
      });
      const { svc } = makeService({ tx });
      const res = await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);

      expect(res.captured).toBe(2);
      const ids = tx.staffAttendance.create.mock.calls.map((c: any) => c[0].data.userId);
      expect(ids).not.toContain(DRIVER_ID);
    });

    it('records a roster member in absentUserIds as ABSENT, everyone else PRESENT — no ledger entry', async () => {
      const { svc, tx, staffLedger } = makeService();
      const res = await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId, [LOADER_ID]);

      expect(res.captured).toBe(3);
      const byUser = Object.fromEntries(
        tx.staffAttendance.create.mock.calls.map((c: any) => [c[0].data.userId, c[0].data.status]),
      );
      expect(byUser[LOADER_ID]).toBe(AttendanceStatus.ABSENT);
      expect(byUser[DRIVER_ID]).toBe(AttendanceStatus.PRESENT);
      expect(byUser[SALESMAN_ID]).toBe(AttendanceStatus.PRESENT);
      // capture never touches the ledger — that is markStatus's job.
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      for (const call of tx.staffAttendance.create.mock.calls) {
        expect(call[0].data.leaveLedgerEntryId).toBeUndefined();
      }
    });

    it('re-confirm flips an existing auto PRESENT row to ABSENT when the user is now in absentUserIds', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'att-present',
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.CREW_CONFIRM,
            leaveLedgerEntryId: null,
            dailySheetId: SHEET_ID,
          }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const { svc } = makeService({ tx });
      await svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId, [DRIVER_ID]);

      expect(tx.staffAttendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: AttendanceStatus.ABSENT }) }),
      );
    });

    it('swallows a P2002 unique-violation from a concurrent capture and keeps going', async () => {
      const err: any = new Error('unique');
      err.code = 'P2002';
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest
            .fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValue({ id: 'ok' }),
          update: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      await expect(
        svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId),
      ).resolves.toEqual(expect.objectContaining({ captured: 2 }));
    });
  });

  describe('markStatus()', () => {
    it('marks PRESENT without creating any ledger entry', async () => {
      const { svc, tx, staffLedger } = makeService();
      await svc.markStatus(managerUser, { userId: DRIVER_ID, date: '2026-08-05', status: AttendanceStatus.PRESENT });

      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.MANUAL,
            leaveLedgerEntryId: null,
          }),
        }),
      );
    });

    it('ABSENT with an explicit amount creates a LEAVE_UNPAID entry (negative, effectiveDate = the marked day) in the same transaction and links it', async () => {
      const { svc, tx, prisma, staffLedger } = makeService();
      await svc.markStatus(managerUser, {
        userId: DRIVER_ID,
        date: '2026-08-05',
        status: AttendanceStatus.ABSENT,
        amount: 800,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(staffLedger.createTx).toHaveBeenCalledWith(
        tx,
        managerUser,
        expect.objectContaining({
          userId: DRIVER_ID,
          category: StaffLedgerCategory.LEAVE_UNPAID,
          amount: -800,
          effectiveDate: '2026-08-05T00:00:00.000Z',
        }),
      );
      expect(tx.staffAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ leaveLedgerEntryId: 'ledger-entry-001' }) }),
      );
    });

    it('HALF_DAY debits the given amount and labels the entry a half-day', async () => {
      const { svc, staffLedger } = makeService();
      await svc.markStatus(managerUser, {
        userId: DRIVER_ID,
        date: '2026-08-05',
        status: AttendanceStatus.HALF_DAY,
        amount: 400,
      });
      expect(staffLedger.createTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ amount: -400, description: expect.stringContaining('half-day') }),
      );
    });

    it('rejects an ABSENT marking with no amount', async () => {
      const { svc, prisma } = makeService();
      await expect(
        svc.markStatus(managerUser, { userId: DRIVER_ID, date: '2026-08-05', status: AttendanceStatus.ABSENT }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an amount on a non-unpaid status', async () => {
      const { svc } = makeService();
      await expect(
        svc.markStatus(managerUser, {
          userId: DRIVER_ID,
          date: '2026-08-05',
          status: AttendanceStatus.PRESENT,
          amount: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to re-mark a day that already carries a ledger bridge', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({ id: 'att-bridged', leaveLedgerEntryId: 'ledger-entry-001' }),
          create: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
          findMany: jest.fn(),
        },
      });
      const { svc } = makeService({ tx });
      await expect(
        svc.markStatus(managerUser, {
          userId: DRIVER_ID,
          date: '2026-08-05',
          status: AttendanceStatus.PRESENT,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound when the employee is not in the vendor', async () => {
      const { svc } = makeService({ employeeExists: false });
      await expect(
        svc.markStatus(managerUser, { userId: 'ghost', date: '2026-08-05', status: AttendanceStatus.PRESENT }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rolls back — if the ledger createTx throws, the attendance row is never written', async () => {
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
          findMany: jest.fn(),
        },
      });
      const { svc, staffLedger } = makeService({ tx });
      staffLedger.createTx.mockRejectedValueOnce(new Error('gate failure'));

      await expect(
        svc.markStatus(managerUser, {
          userId: DRIVER_ID,
          date: '2026-08-05',
          status: AttendanceStatus.ABSENT,
          amount: 800,
        }),
      ).rejects.toThrow('gate failure');
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('listByPeriod throws NotFound for an unknown period', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollPeriod.findFirst.mockResolvedValueOnce(null);
      await expect(svc.listByPeriod(managerUser, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('listByEmployee allows self-view without the permission', async () => {
      const { svc, prisma, permissions } = makeService();
      prisma.user.findFirst.mockResolvedValueOnce({ id: managerUser.userId });
      await svc.listByEmployee(managerUser, managerUser.userId);
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('listByEmployee forbids viewing another employee without payroll:attendance_view', async () => {
      const { svc } = makeService({ canViewAll: false });
      await expect(svc.listByEmployee(managerUser, 'someone-else')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('listByEmployee permits viewing another employee with payroll:attendance_view', async () => {
      const { svc, permissions } = makeService({ canViewAll: true });
      await svc.listByEmployee(managerUser, 'someone-else');
      expect(permissions.can).toHaveBeenCalledWith(managerUser.userId, 'payroll:attendance_view');
    });

    it('listBySheet throws NotFound for an unknown sheet', async () => {
      const { svc, prisma } = makeService();
      prisma.dailySheet.findFirst.mockResolvedValueOnce(null);
      await expect(svc.listBySheet(managerUser, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
