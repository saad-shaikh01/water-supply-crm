import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';
import {
  AttendanceSource,
  AttendanceStatus,
  CrewRole,
  DailySheetKind,
  PayrollEntryStatus,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const DRIVER_ID = 'driver-001';
const LOADER_ID = 'loader-001';
const SALESMAN_ID = 'salesman-001';
const SHEET_ID = 'sheet-001';
const SHEET_DATE = new Date('2026-08-05T09:30:00.000Z');
const DAY = new Date('2026-08-05T00:00:00.000Z');

const CATEGORY_ID = 'category-001';

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
    // Merge-review finding H2 (isDateInLockedPeriod): no period covers this
    // date by default, so the lock guard is a no-op for every existing test
    // that doesn't care about it.
    payrollPeriod: {
      findFirst: jest.fn().mockResolvedValue(null),
      ...(overrides.payrollPeriod ?? {}),
    },
    payrollEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      ...(overrides.payrollEntry ?? {}),
    },
  };
}

function makeService(
  opts: {
    tx?: any;
    canViewAll?: boolean;
    employeeExists?: boolean;
    employeeRole?: UserRole;
    categoryExists?: boolean;
  } = {},
) {
  const tx = opts.tx ?? makeTx();
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: {
      findFirst: jest.fn().mockResolvedValue(
        opts.employeeExists === false ? null : { id: DRIVER_ID, role: opts.employeeRole ?? UserRole.DRIVER },
      ),
      findMany: jest.fn().mockResolvedValue([
        { id: DRIVER_ID, isSystem: false },
        { id: LOADER_ID, isSystem: false },
        { id: SALESMAN_ID, isSystem: false },
      ]),
    },
    payrollPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'period-001', startDate: DAY, endDate: DAY }) },
    dailySheet: {
      findFirst: jest.fn().mockResolvedValue({ id: SHEET_ID }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    staffAttendance: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const permissions = { can: jest.fn().mockResolvedValue(opts.canViewAll ?? false) };
  const staffLedger = {
    createTx: jest.fn().mockResolvedValue({ id: 'ledger-entry-001', status: 'POSTED' }),
  };
  const categories = {
    assertExists:
      opts.categoryExists === false
        ? jest.fn().mockRejectedValue(new BadRequestException('Unknown attendance category'))
        : jest.fn().mockResolvedValue(undefined),
  };
  const svc = new StaffAttendanceService(prisma as any, permissions as any, staffLedger as any, categories as any);
  return { svc, prisma, tx, permissions, staffLedger, categories };
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

    describe('locked-period protection (merge-review finding H2)', () => {
      const lockedPeriod = { id: 'period-locked-001' };

      it('does NOT create a new PRESENT row for a date already LOCKED into this user\'s pay', async () => {
        const tx = makeTx({
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPeriod) },
          payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollEntryStatus.LOCKED }) },
        });
        const res = await svcCaptureWith(tx);

        expect(tx.staffAttendance.create).not.toHaveBeenCalled();
        expect(res.captured).toBe(0);
      });

      it('does NOT create a new row for a date already SETTLED', async () => {
        const tx = makeTx({
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPeriod) },
          payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollEntryStatus.SETTLED }) },
        });
        const res = await svcCaptureWith(tx);

        expect(tx.staffAttendance.create).not.toHaveBeenCalled();
        expect(res.captured).toBe(0);
      });

      it('still captures normally when the covering period exists but is NOT locked (DRAFT/APPROVED)', async () => {
        const tx = makeTx({
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPeriod) },
          payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollEntryStatus.APPROVED }) },
        });
        const res = await svcCaptureWith(tx);

        expect(tx.staffAttendance.create).toHaveBeenCalledTimes(3);
        expect(res.captured).toBe(3);
      });

      it('does NOT reconcile (re-point/flip) an EXISTING auto row for a date already LOCKED', async () => {
        const tx = makeTx({
          staffAttendance: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'att-locked-existing',
              status: AttendanceStatus.PRESENT,
              source: AttendanceSource.CREW_CONFIRM,
              leaveLedgerEntryId: null,
              dailySheetId: 'a-different-sheet', // would normally trigger a re-point
            }),
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
            update: jest.fn(),
          },
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPeriod) },
          payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollEntryStatus.LOCKED }) },
        });
        await svcCaptureWith(tx);

        expect(tx.staffAttendance.update).not.toHaveBeenCalled();
      });

      it('does NOT hard-delete a stale reconcile row for a date already LOCKED, even though its user left the roster', async () => {
        const tx = makeTx({
          staffAttendance: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([{ id: 'stale-locked-1', userId: 'someone-else-002', date: SHEET_DATE }]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({ id: 'x' }),
            update: jest.fn(),
          },
          payrollPeriod: { findFirst: jest.fn().mockResolvedValue(lockedPeriod) },
          payrollEntry: { findUnique: jest.fn().mockResolvedValue({ status: PayrollEntryStatus.LOCKED }) },
        });
        const res = await svcCaptureWith(tx);

        expect(tx.staffAttendance.deleteMany).not.toHaveBeenCalled();
        expect(res.reconciled).toBe(0);
      });

      function svcCaptureWith(tx: any) {
        const { svc } = makeService({ tx });
        return svc.captureForConfirmedCrew(tx as any, VENDOR_ID, routeSheet, managerUser.userId);
      }
    });
  });

  describe('markStatus()', () => {
    it('marks PRESENT without creating any ledger entry', async () => {
      const { svc, tx, staffLedger } = makeService();
      await svc.markStatus(managerUser, {
        userId: DRIVER_ID,
        date: '2026-08-05',
        status: AttendanceStatus.PRESENT,
        categoryId: CATEGORY_ID,
      });

      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AttendanceStatus.PRESENT,
            source: AttendanceSource.MANUAL,
            leaveLedgerEntryId: null,
            categoryId: CATEGORY_ID,
          }),
        }),
      );
    });

    it('rejects a PRESENT marking with no categoryId', async () => {
      const { svc } = makeService();
      await expect(
        svc.markStatus(managerUser, { userId: DRIVER_ID, date: '2026-08-05', status: AttendanceStatus.PRESENT }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a categoryId on a non-PRESENT status', async () => {
      const { svc } = makeService();
      await expect(
        svc.markStatus(managerUser, {
          userId: DRIVER_ID,
          date: '2026-08-05',
          status: AttendanceStatus.LEAVE,
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a PRESENT marking whose categoryId does not resolve to this vendor', async () => {
      const { svc } = makeService({ categoryExists: false });
      await expect(
        svc.markStatus(managerUser, {
          userId: DRIVER_ID,
          date: '2026-08-05',
          status: AttendanceStatus.PRESENT,
          categoryId: 'not-a-real-category',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a manual ABSENT/LEAVE/HALF_DAY/WEEKLY_OFF marking never carries a category', async () => {
      const { svc, tx } = makeService();
      await svc.markStatus(managerUser, { userId: DRIVER_ID, date: '2026-08-05', status: AttendanceStatus.WEEKLY_OFF });
      expect(tx.staffAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ categoryId: null }) }),
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

    it('ABSENT with no amount records the day operationally with no ledger entry (admin adjusts pay later)', async () => {
      const { svc, tx, staffLedger } = makeService();
      await svc.markStatus(managerUser, { userId: DRIVER_ID, date: '2026-08-05', status: AttendanceStatus.ABSENT });

      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AttendanceStatus.ABSENT, leaveLedgerEntryId: null }),
        }),
      );
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
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound when the employee is not in the vendor', async () => {
      const { svc } = makeService({ employeeExists: false });
      await expect(
        svc.markStatus(managerUser, {
          userId: 'ghost',
          date: '2026-08-05',
          status: AttendanceStatus.PRESENT,
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects marking attendance for a non-payroll-eligible role (merge-review finding N1)', async () => {
      const { svc, tx, prisma } = makeService({ employeeRole: UserRole.CUSTOMER });
      await expect(
        svc.markStatus(managerUser, {
          userId: 'a-customer-001',
          date: '2026-08-05',
          status: AttendanceStatus.PRESENT,
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
    });

    it.each([UserRole.STAFF, UserRole.DRIVER, UserRole.SALESMAN, UserRole.LOADER])(
      'permits marking attendance for the eligible role %s',
      async (role) => {
        const { svc } = makeService({ employeeRole: role });
        await expect(
          svc.markStatus(managerUser, {
            userId: DRIVER_ID,
            date: '2026-08-05',
            status: AttendanceStatus.PRESENT,
            categoryId: CATEGORY_ID,
          }),
        ).resolves.toBeDefined();
      },
    );

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

  describe('backfillForPeriod()', () => {
    it('throws NotFound for an unknown period', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollPeriod.findFirst.mockResolvedValueOnce(null);
      await expect(svc.backfillForPeriod(managerUser, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-captures a crewConfirmed sheet with no attendance rows yet — all PRESENT, none ABSENT', async () => {
      const { svc, prisma, tx } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([
        {
          id: SHEET_ID,
          kind: DailySheetKind.ROUTE,
          date: SHEET_DATE,
          driverId: DRIVER_ID,
          crewConfirmedById: managerUser.userId,
          crew: [
            { userId: LOADER_ID, role: CrewRole.LOADER },
            { userId: SALESMAN_ID, role: CrewRole.SALESMAN },
          ],
        },
      ]);

      const result = await svc.backfillForPeriod(managerUser, 'period-001');

      expect(result).toEqual({ sheetsScanned: 1, sheetsTouched: 1, created: 3 });
      expect(tx.staffAttendance.create).toHaveBeenCalledTimes(3);
      for (const call of tx.staffAttendance.create.mock.calls) {
        expect(call[0].data).toEqual(
          expect.objectContaining({ status: AttendanceStatus.PRESENT, markedById: managerUser.userId }),
        );
      }
    });

    it('leaves an existing row completely untouched — never updates, never overwrites its status', async () => {
      // ABSENT/MANUAL on purpose: this is exactly the row a naive "reconcile"
      // sweep would be tempted to flip back to PRESENT. The gap-fill sweep
      // must not even inspect its status/source — existence alone skips it.
      const tx = makeTx({
        staffAttendance: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'existing',
            source: AttendanceSource.MANUAL,
            leaveLedgerEntryId: 'ledger-001',
            dailySheetId: 'some-other-sheet',
            status: AttendanceStatus.ABSENT,
          }),
        },
      });
      const { svc, prisma } = makeService({ tx });
      prisma.dailySheet.findMany.mockResolvedValue([routeSheet]);

      const result = await svc.backfillForPeriod(managerUser, 'period-001');

      expect(result).toEqual({ sheetsScanned: 1, sheetsTouched: 0, created: 0 });
      expect(tx.staffAttendance.create).not.toHaveBeenCalled();
      expect(tx.staffAttendance.update).not.toHaveBeenCalled();
      expect(tx.staffAttendance.deleteMany).not.toHaveBeenCalled();
    });

    it('scans only crewConfirmed, non-WALK_IN sheets within the period', async () => {
      const { svc, prisma } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([]);

      await svc.backfillForPeriod(managerUser, 'period-001');

      expect(prisma.dailySheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            vendorId: VENDOR_ID,
            kind: { not: DailySheetKind.WALK_IN },
            crewConfirmed: true,
          }),
        }),
      );
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
