import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  AttendanceSource,
  AttendanceStatus,
  LedgerEntryStatus,
  PayrollEntryStatus,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import { StaffAttendanceService } from './staff-attendance.service';
import { AbsenceDecisionAction, ResolveAbsenceDeductionDto } from './dto/resolve-absence-deduction.dto';

const VENDOR_ID = 'vendor-001';
const EMP_ID = 'emp-001';
const admin = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** One attendance row as the service reads it (with its leave-entry include). */
function row(date: string, status: AttendanceStatus, patch: any = {}) {
  return {
    id: `att-${date}`,
    vendorId: VENDOR_ID,
    userId: EMP_ID,
    date: d(date),
    status,
    version: 3,
    leaveLedgerEntryId: null,
    leaveLedgerEntry: null,
    deductionWaivedAt: null,
    deductionWaivedById: null,
    deductionWaivedReason: null,
    ...patch,
  };
}

const liveEntry = (id = 'le-live') => ({ id, status: LedgerEntryStatus.POSTED, version: 7 });

function makeService(
  opts: { rows?: any[]; employeeExists?: boolean; role?: UserRole; lockedDates?: string[]; claimCount?: number } = {},
) {
  const tx: any = {
    staffAttendance: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'att-new', ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'att-upd', ...data })),
    },
    // Batched lock probe: ONE query for the periods touching the requested days, ONE for this employee's
    // LOCKED/SETTLED entries in them. `lockedDates` become one-day periods whose entry is LOCKED; every other
    // requested day sits in an open one-month period with no locked entry.
    payrollPeriod: {
      findMany: jest.fn().mockImplementation(async () => [
        { id: 'open-period', startDate: d('2026-08-01'), endDate: new Date('2026-09-30T23:59:59.999Z') },
        ...(opts.lockedDates ?? []).map((day) => ({ id: `locked-${day}`, startDate: d(day), endDate: new Date(`${day}T23:59:59.999Z`) })),
      ]),
    },
    payrollEntry: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        (opts.lockedDates ?? [])
          .map((day) => `locked-${day}`)
          .filter((id) => where.periodId.in.includes(id))
          .map((periodId) => ({ periodId })),
      ),
    },
  };
  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.employeeExists === false ? null : { id: EMP_ID, role: opts.role ?? UserRole.DRIVER }),
    },
  };
  const staffLedger: any = {
    createTx: jest.fn().mockImplementation(async (_tx: any, _u: any, dto: any) => ({ id: `le-new-${dto.effectiveDate.slice(0, 10)}`, status: 'POSTED' })),
    voidEntryTx: jest.fn().mockResolvedValue({ id: 'voided' }),
  };
  const payrollEntries: any = { refreshDraftEntryTx: jest.fn().mockResolvedValue(true) };
  const svc = new StaffAttendanceService(prisma, { can: jest.fn() } as any, staffLedger, { assertExists: jest.fn() } as any, payrollEntries);
  return { svc, tx, prisma, staffLedger, payrollEntries };
}

const dto = (over: Partial<ResolveAbsenceDeductionDto>): ResolveAbsenceDeductionDto =>
  ({ userId: EMP_ID, dates: ['2026-09-01'], action: AbsenceDecisionAction.UNPAID, dailyRate: 1000, ...over }) as ResolveAbsenceDeductionDto;

describe('StaffAttendanceService.resolveAbsenceDecisions()', () => {
  describe('UNPAID', () => {
    it('posts one LEAVE_UNPAID debit per selected day at the daily rate, dated that day, and links it on the row', async () => {
      const { svc, tx, staffLedger } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT), row('2026-09-02', AttendanceStatus.ABSENT)],
      });
      const res = await svc.resolveAbsenceDecisions(admin, dto({ dates: ['2026-09-01', '2026-09-02'], dailyRate: 1167 }));

      expect(staffLedger.createTx).toHaveBeenCalledTimes(2);
      expect(staffLedger.createTx.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          userId: EMP_ID,
          category: StaffLedgerCategory.LEAVE_UNPAID,
          amount: -1167,
          effectiveDate: '2026-09-01T00:00:00.000Z',
        }),
      );
      expect(tx.staffAttendance.updateMany).toHaveBeenCalledWith({
        where: { id: 'att-2026-09-01', version: 3 },
        data: expect.objectContaining({
          leaveLedgerEntryId: 'le-new-2026-09-01',
          deductionWaivedAt: null,
          deductionWaivedById: null,
          deductionWaivedReason: null,
          version: { increment: 1 },
        }),
      });
      expect(res).toEqual({ action: 'UNPAID', requested: 2, affected: 2, unchanged: 0, totalDeducted: 2334, draftsRefreshed: 1 });
    });

    it('charges a HALF_DAY half the rate (rounded to a rupee) and the total adds up', async () => {
      const { svc, staffLedger } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT), row('2026-09-02', AttendanceStatus.HALF_DAY)],
      });
      const res = await svc.resolveAbsenceDecisions(admin, dto({ dates: ['2026-09-01', '2026-09-02'], dailyRate: 1167 }));
      expect(staffLedger.createTx.mock.calls.map((c: any) => c[2].amount)).toEqual([-1167, -584]); // 583.5 -> 584
      expect(res.totalDeducted).toBe(1167 + 584);
    });

    it('leaves a day that already has a LIVE deduction alone (idempotent - never double-charges)', async () => {
      const { svc, tx, staffLedger } = makeService({
        rows: [
          row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() }),
          row('2026-09-02', AttendanceStatus.ABSENT),
        ],
      });
      const res = await svc.resolveAbsenceDecisions(admin, dto({ dates: ['2026-09-01', '2026-09-02'] }));
      expect(staffLedger.createTx).toHaveBeenCalledTimes(1);
      expect(tx.staffAttendance.updateMany).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ affected: 1, unchanged: 1, totalDeducted: 1000 });
    });

    it('re-deducts a day whose earlier deduction was VOIDED, replacing the dead pointer', async () => {
      const { svc, tx, staffLedger } = makeService({
        rows: [
          row('2026-09-01', AttendanceStatus.ABSENT, {
            leaveLedgerEntryId: 'le-dead',
            leaveLedgerEntry: { id: 'le-dead', status: LedgerEntryStatus.VOIDED, version: 2 },
          }),
        ],
      });
      await svc.resolveAbsenceDecisions(admin, dto({}));
      expect(staffLedger.createTx).toHaveBeenCalledTimes(1);
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data.leaveLedgerEntryId).toBe('le-new-2026-09-01');
    });

    it('switches a WAIVED day to unpaid and clears the waiver', async () => {
      const { svc, tx } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT, { deductionWaivedAt: new Date(), deductionWaivedById: 'x', deductionWaivedReason: 'ok' })],
      });
      await svc.resolveAbsenceDecisions(admin, dto({}));
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data).toMatchObject({
        deductionWaivedAt: null,
        deductionWaivedById: null,
        deductionWaivedReason: null,
      });
    });

    it('uses the admin note as the ledger description when given', async () => {
      const { svc, staffLedger } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      await svc.resolveAbsenceDecisions(admin, dto({ note: 'Unauthorised absence' }));
      expect(staffLedger.createTx.mock.calls[0][2].description).toBe('Unauthorised absence');
    });

    it('requires dailyRate', async () => {
      const { svc, tx } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      await expect(svc.resolveAbsenceDecisions(admin, dto({ dailyRate: undefined }))).rejects.toThrow(/dailyRate/);
      expect(tx.staffAttendance.findMany).not.toHaveBeenCalled();
    });
  });

  describe('WAIVE', () => {
    it('records the paid/waived decision (who, when, why) and posts NO ledger entry', async () => {
      const { svc, tx, staffLedger } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT), row('2026-09-02', AttendanceStatus.HALF_DAY)] });
      const res = await svc.resolveAbsenceDecisions(
        admin,
        dto({ action: AbsenceDecisionAction.WAIVE, dailyRate: undefined, dates: ['2026-09-01', '2026-09-02'], note: 'Medical leave, approved' }),
      );
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data).toMatchObject({
        deductionWaivedById: admin.userId,
        deductionWaivedReason: 'Medical leave, approved',
        leaveLedgerEntryId: null,
        version: { increment: 1 },
      });
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data.deductionWaivedAt).toBeInstanceOf(Date);
      expect(res).toEqual({ action: 'WAIVE', requested: 2, affected: 2, unchanged: 0, totalDeducted: 0, draftsRefreshed: 1 });
    });

    it('refuses a day that has a live deduction (reset it first) and writes nothing', async () => {
      const { svc } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() })],
      });
      await expect(
        svc.resolveAbsenceDecisions(admin, dto({ action: AbsenceDecisionAction.WAIVE, dailyRate: undefined })),
      ).rejects.toThrow(/reset it first/);
    });

    it('an already-waived day is left unchanged', async () => {
      const { svc, tx } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT, { deductionWaivedAt: new Date() })] });
      const res = await svc.resolveAbsenceDecisions(admin, dto({ action: AbsenceDecisionAction.WAIVE, dailyRate: undefined }));
      expect(tx.staffAttendance.updateMany).not.toHaveBeenCalled();
      expect(res).toMatchObject({ affected: 0, unchanged: 1 });
    });

    it('rejects dailyRate', async () => {
      const { svc } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      await expect(svc.resolveAbsenceDecisions(admin, dto({ action: AbsenceDecisionAction.WAIVE }))).rejects.toThrow(/dailyRate/);
    });
  });

  describe('RESET', () => {
    const resetDto = (over: Partial<ResolveAbsenceDeductionDto> = {}) =>
      dto({ action: AbsenceDecisionAction.RESET, dailyRate: undefined, ...over });

    it('voids a live deduction through the ledger (audited, creator check skipped because attendance owns it) and unlinks the day', async () => {
      const { svc, tx, staffLedger } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() })],
      });
      const res = await svc.resolveAbsenceDecisions(admin, resetDto({ note: 'Entered by mistake' }));
      // No `skipCreatorCheck`: the ledger's own rule (creator OR payroll:ledger_void) stays in force, so
      // holding only payroll:attendance_mark can never void somebody else's deduction.
      expect(staffLedger.voidEntryTx).toHaveBeenCalledWith(tx, admin, 'le-live', { version: 7, reason: 'Entered by mistake' });
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data).toMatchObject({ leaveLedgerEntryId: null, deductionWaivedAt: null });
      expect(res).toMatchObject({ affected: 1, unchanged: 0 });
    });

    it('clears a waiver (no ledger involved)', async () => {
      const { svc, tx, staffLedger } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT, { deductionWaivedAt: new Date() })] });
      await svc.resolveAbsenceDecisions(admin, resetDto());
      expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.updateMany.mock.calls[0][0].data).toMatchObject({ deductionWaivedAt: null });
    });

    it('a user without the ledger-void authority cannot reset a deduction somebody else posted (whole batch rolls back)', async () => {
      const { svc, staffLedger } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() })],
      });
      staffLedger.voidEntryTx.mockRejectedValue(new ForbiddenException('You may only void a ledger entry you created yourself.'));
      await expect(svc.resolveAbsenceDecisions(admin, resetDto())).rejects.toThrow(ForbiddenException);
    });

    it('a day that is already pending is unchanged', async () => {
      const { svc, tx } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      const res = await svc.resolveAbsenceDecisions(admin, resetDto());
      expect(tx.staffAttendance.updateMany).not.toHaveBeenCalled();
      expect(res).toMatchObject({ affected: 0, unchanged: 1 });
    });

    it('propagates the ledger refusal when the deduction is already rolled into a locked payroll (whole batch rolls back)', async () => {
      const { svc, staffLedger } = makeService({
        rows: [row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() })],
      });
      staffLedger.voidEntryTx.mockRejectedValue(new BadRequestException('Only PENDING entries or POSTED entries not yet rolled into a locked payroll period can be voided.'));
      await expect(svc.resolveAbsenceDecisions(admin, resetDto())).rejects.toThrow(/not yet rolled into a locked/);
    });
  });

  describe('all-or-nothing validation', () => {
    it('rejects the WHOLE batch, naming every bad day, if any day is missing / not Absent-Half day / locked - and writes nothing', async () => {
      const { svc, tx, staffLedger } = makeService({
        rows: [
          row('2026-09-01', AttendanceStatus.ABSENT),
          row('2026-09-02', AttendanceStatus.PRESENT),
          row('2026-09-04', AttendanceStatus.ABSENT),
        ],
        lockedDates: ['2026-09-04'],
      });
      const err: any = await svc
        .resolveAbsenceDecisions(admin, dto({ dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'] }))
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('2026-09-02: is PRESENT');
      expect(err.message).toContain('2026-09-03: no attendance record');
      expect(err.message).toContain('2026-09-04: already locked');
      expect(err.message).not.toContain('2026-09-01');
      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.staffAttendance.updateMany).not.toHaveBeenCalled();
    });

    it.each([AttendanceStatus.LEAVE, AttendanceStatus.WEEKLY_OFF, AttendanceStatus.PRESENT])('refuses a %s day', async (status) => {
      const { svc } = makeService({ rows: [row('2026-09-01', status)] });
      await expect(svc.resolveAbsenceDecisions(admin, dto({}))).rejects.toThrow(BadRequestException);
    });

    it('404s for an employee outside the vendor', async () => {
      const { svc } = makeService({ employeeExists: false });
      await expect(svc.resolveAbsenceDecisions(admin, dto({}))).rejects.toThrow(NotFoundException);
    });

    it('refuses a non payroll-eligible account', async () => {
      const { svc } = makeService({ role: UserRole.CUSTOMER });
      await expect(svc.resolveAbsenceDecisions(admin, dto({}))).rejects.toThrow(/payroll-eligible/);
    });

    it('refuses a calendar day that does not exist instead of letting Date roll it over (2026-02-31 -> Mar 3)', async () => {
      const { svc, tx } = makeService({ rows: [row('2026-03-03', AttendanceStatus.ABSENT)] });
      await expect(svc.resolveAbsenceDecisions(admin, dto({ dates: ['2026-02-31'] }))).rejects.toThrow(/not a valid calendar day/);
      expect(tx.staffAttendance.updateMany).not.toHaveBeenCalled();
    });

    it('checks the lock for the WHOLE batch with a fixed number of queries, not two per day', async () => {
      const days = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
      const { svc, tx } = makeService({ rows: days.map((x) => row(x, AttendanceStatus.ABSENT)) });
      await svc.resolveAbsenceDecisions(admin, dto({ dates: days, action: AbsenceDecisionAction.WAIVE, dailyRate: undefined }));
      expect(tx.payrollPeriod.findMany).toHaveBeenCalledTimes(1);
      expect(tx.payrollEntry.findMany).toHaveBeenCalledTimes(1);
    });

    it('refreshes the employee DRAFT payroll entry of each touched period in the same transaction - and only when something changed', async () => {
      const { svc, payrollEntries, tx } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      await svc.resolveAbsenceDecisions(admin, dto({}));
      expect(payrollEntries.refreshDraftEntryTx).toHaveBeenCalledTimes(1);
      expect(payrollEntries.refreshDraftEntryTx).toHaveBeenCalledWith(tx, admin, EMP_ID, expect.objectContaining({ id: 'open-period' }));

      const idle = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT, { leaveLedgerEntryId: 'le-live', leaveLedgerEntry: liveEntry() })] });
      await idle.svc.resolveAbsenceDecisions(admin, dto({})); // already deducted -> nothing changed
      expect(idle.payrollEntries.refreshDraftEntryTx).not.toHaveBeenCalled();
    });

    it('treats two timestamps on the same calendar day as ONE day (no double deduction)', async () => {
      const { svc, staffLedger } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      const res = await svc.resolveAbsenceDecisions(admin, dto({ dates: ['2026-09-01T03:00:00.000Z', '2026-09-01T22:00:00.000Z'] }));
      expect(staffLedger.createTx).toHaveBeenCalledTimes(1);
      expect(res.requested).toBe(1);
    });

    it('409s - rolling the batch back - when someone else changed a row in between (stale version)', async () => {
      const { svc } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)], claimCount: 0 });
      await expect(svc.resolveAbsenceDecisions(admin, dto({}))).rejects.toThrow(ConflictException);
    });

    it('scopes the attendance lookup to the vendor and employee', async () => {
      const { svc, tx } = makeService({ rows: [row('2026-09-01', AttendanceStatus.ABSENT)] });
      await svc.resolveAbsenceDecisions(admin, dto({}));
      expect(tx.staffAttendance.findMany.mock.calls[0][0].where).toEqual({
        vendorId: VENDOR_ID,
        userId: EMP_ID,
        date: { in: [d('2026-09-01')] },
      });
    });
  });
});

describe('ResolveAbsenceDeductionDto validation', () => {
  const ok = { userId: '3f1c4b1e-8a6e-4c64-9a53-0b8f1b6b1d11', dates: ['2026-09-01'], action: 'WAIVE' };
  const errorsFor = async (patch: any) => validate(plainToInstance(ResolveAbsenceDeductionDto, { ...ok, ...patch }));

  it('accepts a minimal valid payload', async () => expect(await errorsFor({})).toHaveLength(0));
  it('rejects an empty date list', async () => expect(await errorsFor({ dates: [] })).not.toHaveLength(0));
  it('rejects duplicate dates', async () => expect(await errorsFor({ dates: ['2026-09-01', '2026-09-01'] })).not.toHaveLength(0));
  it('rejects a non-date', async () => expect(await errorsFor({ dates: ['tomorrow'] })).not.toHaveLength(0));
  it('rejects a timestamp - an offset would be shifted to a neighbouring UTC day', async () => {
    expect(await errorsFor({ dates: ['2026-10-07T01:00:00+05:00'] })).not.toHaveLength(0);
    expect(await errorsFor({ dates: ['2026-10-07T00:00:00.000Z'] })).not.toHaveLength(0);
  });
  it('rejects an impossible month/day', async () => {
    expect(await errorsFor({ dates: ['2026-13-01'] })).not.toHaveLength(0);
    expect(await errorsFor({ dates: ['2026-00-10'] })).not.toHaveLength(0);
  });
  it('rejects an absurd daily rate (Int overflow / wrecked totals)', async () => {
    expect(await errorsFor({ action: 'UNPAID', dailyRate: 2_000_000_000 })).not.toHaveLength(0);
    expect(await errorsFor({ action: 'UNPAID', dailyRate: 10_000_000 })).toHaveLength(0);
  });
  it('rejects more than 62 days', async () => {
    const dates = Array.from({ length: 63 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    expect(await errorsFor({ dates })).not.toHaveLength(0);
  });
  it('rejects an unknown action', async () => expect(await errorsFor({ action: 'DELETE' })).not.toHaveLength(0));
  it('rejects a zero / negative / fractional rate', async () => {
    for (const dailyRate of [0, -5, 10.5]) expect(await errorsFor({ action: 'UNPAID', dailyRate })).not.toHaveLength(0);
  });
  it('rejects a non-uuid userId', async () => expect(await errorsFor({ userId: 'abc' })).not.toHaveLength(0));
});

describe('StaffAttendanceService - existing flows respect the new decision state', () => {
  const day = d('2026-09-05');

  function lightService(existing: any) {
    const tx: any = {
      staffAttendance: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'n', ...data })),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'u', ...data })),
      },
    };
    const prisma: any = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      user: { findFirst: jest.fn().mockResolvedValue({ id: EMP_ID, role: UserRole.DRIVER }) },
    };
    const staffLedger: any = { createTx: jest.fn().mockResolvedValue({ id: 'le-new' }) };
    return {
      svc: new StaffAttendanceService(prisma, { can: jest.fn() } as any, staffLedger, { assertExists: jest.fn() } as any, {} as any),
      tx,
      staffLedger,
    };
  }

  it('re-marking a waived day to a different status clears the waiver (it is a fresh decision point)', async () => {
    const { svc, tx } = lightService({ id: 'a1', status: AttendanceStatus.HALF_DAY, leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: new Date() });
    await svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.ABSENT });
    expect(tx.staffAttendance.update.mock.calls[0][0].data).toMatchObject({
      deductionWaivedAt: null,
      deductionWaivedById: null,
      deductionWaivedReason: null,
    });
  });

  it('re-marking the SAME status with no deduction (e.g. just fixing the note) keeps the waiver', async () => {
    const waivedAt = new Date('2026-09-02T10:00:00.000Z');
    const { svc, tx } = lightService({
      id: 'a1',
      status: AttendanceStatus.ABSENT,
      leaveLedgerEntryId: null,
      leaveLedgerEntry: null,
      deductionWaivedAt: waivedAt,
    });
    await svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.ABSENT, note: 'fixed typo' });
    const data = tx.staffAttendance.update.mock.calls[0][0].data;
    expect('deductionWaivedAt' in data).toBe(false); // untouched, not nulled
    expect(data.note).toBe('fixed typo');
  });

  it('re-marking to a DIFFERENT status, or posting a deduction, still clears the waiver', async () => {
    const waived = { id: 'a1', leaveLedgerEntryId: null, leaveLedgerEntry: null, deductionWaivedAt: new Date() };
    const changed = lightService({ ...waived, status: AttendanceStatus.ABSENT });
    await changed.svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.HALF_DAY });
    expect(changed.tx.staffAttendance.update.mock.calls[0][0].data).toMatchObject({ deductionWaivedAt: null });

    const deducted = lightService({ ...waived, status: AttendanceStatus.ABSENT });
    await deducted.svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.ABSENT, amount: 700 });
    expect(deducted.tx.staffAttendance.update.mock.calls[0][0].data).toMatchObject({ deductionWaivedAt: null });
  });

  it('a VOIDED leave entry no longer blocks re-marking the day', async () => {
    const { svc, tx } = lightService({
      id: 'a1',
      leaveLedgerEntryId: 'le-dead',
      leaveLedgerEntry: { status: LedgerEntryStatus.VOIDED },
      deductionWaivedAt: null,
    });
    await svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.ABSENT, amount: 700 });
    expect(tx.staffAttendance.update).toHaveBeenCalled();
    expect(tx.staffAttendance.update.mock.calls[0][0].data.leaveLedgerEntryId).toBe('le-new');
  });

  it('a LIVE leave entry still blocks re-marking (unchanged behaviour)', async () => {
    const { svc, tx } = lightService({
      id: 'a1',
      leaveLedgerEntryId: 'le-live',
      leaveLedgerEntry: { status: LedgerEntryStatus.POSTED },
      deductionWaivedAt: null,
    });
    await expect(
      svc.markStatus(admin, { userId: EMP_ID, date: '2026-09-05', status: AttendanceStatus.ABSENT }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.staffAttendance.update).not.toHaveBeenCalled();
  });

  it('crew re-confirmation never flips or re-points a WAIVED auto row (a deliberate human decision, like a posted deduction)', async () => {
    const tx: any = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: EMP_ID, isSystem: false }]) },
      staffAttendance: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'a1',
          source: AttendanceSource.CREW_CONFIRM,
          status: AttendanceStatus.ABSENT,
          dailySheetId: 'old-sheet',
          leaveLedgerEntryId: null,
          deductionWaivedAt: new Date(),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      payrollPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
      payrollEntry: { findUnique: jest.fn() },
    };
    const svc = new StaffAttendanceService({} as any, { can: jest.fn() } as any, {} as any, {} as any, {} as any);
    await svc.captureForConfirmedCrew(
      tx,
      VENDOR_ID,
      { id: 'sheet-1', kind: 'ROUTE' as any, date: day, driverId: EMP_ID, crew: [] },
      admin.userId,
      [],
    );
    expect(tx.staffAttendance.update).not.toHaveBeenCalled();
    expect(tx.staffAttendance.create).not.toHaveBeenCalled();
  });

  it('crew re-confirmation never deletes a stale auto row that carries a waiver', async () => {
    const tx: any = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: EMP_ID, isSystem: false }]) },
      staffAttendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
      },
      payrollPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
      payrollEntry: { findUnique: jest.fn() },
    };
    const svc = new StaffAttendanceService({} as any, { can: jest.fn() } as any, {} as any, {} as any, {} as any);
    await svc.captureForConfirmedCrew(
      tx,
      VENDOR_ID,
      { id: 'sheet-1', kind: 'ROUTE' as any, date: day, driverId: EMP_ID, crew: [] },
      admin.userId,
      [],
    );
    expect(tx.staffAttendance.findMany.mock.calls[0][0].where).toMatchObject({
      leaveLedgerEntryId: null,
      deductionWaivedAt: null,
    });
  });
});
