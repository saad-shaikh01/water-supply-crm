import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  AttendanceSource,
  AttendanceStatus,
  CrewRole,
  DailySheetKind,
  PayrollEntryStatus,
  Prisma,
  StaffLedgerCategory,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { assertCanViewEmployeeAttendance } from '../../common/helpers/attendance-view-scope.util';
import { PermissionService } from '../authz/permission.service';
import { StaffLedgerService } from './staff-ledger.service';
import { PAYROLL_ELIGIBLE_ROLES } from './payroll-entry.service';
import { MarkAttendanceDto, UNPAID_ATTENDANCE_STATUSES } from './dto/mark-attendance.dto';

/** Midnight UTC of the given day — the canonical bucket for a (userId, date) row. */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** YYYY-MM-DD of a UTC-day Date, for human-readable ledger descriptions. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The minimal shape `captureForConfirmedCrew` needs from a confirmed sheet.
 * `crew` excludes the driver (DailySheet.driverId is the single source of
 * truth for the accountable driver — see schema comment on DailySheetCrew).
 */
export interface ConfirmedCrewSheet {
  id: string;
  kind: DailySheetKind;
  date: Date;
  driverId: string;
  crew: { userId: string; role: CrewRole }[];
}

/**
 * Staff Attendance (docs/features/staff-attendance-and-wage-types.md, Phase 1) —
 * an OPERATIONAL per-employee-per-day record. It deliberately has no audit-log
 * sibling: the only financial consequence, an unpaid absence, is a linked
 * LEAVE_UNPAID `StaffLedgerEntry` created through `StaffLedgerService.createTx`,
 * which carries its own `StaffLedgerAuditLog`.
 *
 * Two entry points:
 *  - `captureForConfirmedCrew` — composed into `DailySheetService.confirmCrew`'s
 *    transaction (same tx-parameterized pattern as
 *    `CrewCashDistributionService.syncSheetToLedger`); idempotent + reconciling,
 *    creates PRESENT / CREW_CONFIRM rows and never touches a manually-marked or
 *    financially-bridged day.
 *  - `markStatus` — the manual endpoint; for ABSENT / HALF_DAY it also creates
 *    the one LEAVE_UNPAID ledger entry, atomically.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly staffLedger: StaffLedgerService,
  ) {}

  /**
   * Auto-capture from a crew confirmation. Runs on BOTH the first confirmation
   * and every re-confirmation (e.g. after a swap-assignment reset
   * `crewConfirmed` to false), so it must be idempotent and reconciling:
   *
   *  - upsert a PRESENT / CREW_CONFIRM row for every roster member (the driver,
   *    role DRIVER, plus each DailySheetCrew member) keyed on (userId, date);
   *  - NEVER overwrite a row whose `source` is MANUAL or that already carries a
   *    `leaveLedgerEntryId` — those are deliberate human/financial decisions;
   *  - delete a stale CREW_CONFIRM row previously captured for THIS sheet whose
   *    user is no longer on the roster and which has no `leaveLedgerEntryId`.
   *
   * Walk-in / system sheets never reach `confirmCrew`, but are guarded here
   * defensively (kind === WALK_IN short-circuits; `isSystem` users are skipped)
   * so a future move of the call site cannot create attendance for a sentinel.
   *
   * `absentUserIds` (Phase 2): roster members to record as ABSENT instead of
   * PRESENT — operational only, this method never creates a ledger entry. On a
   * re-confirm the PRESENT/ABSENT status of an existing auto (CREW_CONFIRM) row
   * is reconciled to match; MANUAL rows and rows already bridged to a ledger
   * entry are still never touched.
   *
   * Composes into the caller's transaction — never opens its own.
   */
  async captureForConfirmedCrew(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheet: ConfirmedCrewSheet,
    actorId: string,
    absentUserIds: string[] = [],
  ): Promise<{ captured: number; reconciled: number }> {
    if (sheet.kind === DailySheetKind.WALK_IN) return { captured: 0, reconciled: 0 };

    const day = startOfUtcDay(sheet.date);
    const absentSet = new Set(absentUserIds);

    // Roster = the driver (never a DailySheetCrew row — DailySheet.driverId is
    // the single source of truth) + every support-crew member.
    const rosterIds = [sheet.driverId, ...sheet.crew.map((m) => m.userId)];

    // Drop any sentinel/foreign users; tenancy-check the rest in one query.
    const users = await tx.user.findMany({
      where: { id: { in: rosterIds }, vendorId },
      select: { id: true, isSystem: true },
    });
    const validIds = new Set(users.filter((u) => !u.isSystem).map((u) => u.id));

    let captured = 0;
    for (const userId of rosterIds) {
      if (!validIds.has(userId)) continue;

      const desiredStatus = absentSet.has(userId) ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT;

      const existing = await tx.staffAttendance.findUnique({
        where: { userId_date: { userId, date: day } },
      });

      if (existing) {
        // Manual decisions and financially-bridged rows are untouchable here.
        if (existing.source === AttendanceSource.MANUAL || existing.leaveLedgerEntryId !== null) continue;
        // Merge-review finding H2: never touch a day already frozen into a
        // LOCKED/SETTLED PayrollEntry for this user — StaffAttendance has no
        // ledger-style `payrollEntryId` claim to protect it the way
        // StaffLedgerEntry does, so this check is the only thing standing
        // between an unrelated crew-swap reconcile and silently changing what
        // a future unlock+regenerate would compute for this employee.
        if (await this.isDateInLockedPeriod(tx, vendorId, userId, day)) continue;
        // Reconcile an existing auto row: re-point it at this sheet (a swap moved
        // the crew) and/or flip PRESENT<->ABSENT to match the confirmation.
        if (existing.dailySheetId !== sheet.id || existing.status !== desiredStatus) {
          await tx.staffAttendance.update({
            where: { id: existing.id },
            data: {
              dailySheetId: sheet.id,
              status: desiredStatus,
              markedById: actorId,
              version: { increment: 1 },
            },
          });
        }
        continue;
      }

      // Same H2 guard for a brand-new row: a date already locked into this
      // user's pay must not gain attendance it didn't have when it was
      // computed, for the same reason it must not lose any.
      if (await this.isDateInLockedPeriod(tx, vendorId, userId, day)) continue;

      try {
        await tx.staffAttendance.create({
          data: {
            vendorId,
            userId,
            date: day,
            status: desiredStatus,
            source: AttendanceSource.CREW_CONFIRM,
            dailySheetId: sheet.id,
            markedById: actorId,
          },
        });
        captured++;
      } catch (err) {
        // A concurrent confirmation raced us to the (userId, date) unique row —
        // harmless, the row exists. Any other error is real.
        if ((err as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002') throw err;
      }
    }

    // Reconcile: auto rows this sheet captured for someone no longer on it.
    const staleRows = await tx.staffAttendance.findMany({
      where: {
        dailySheetId: sheet.id,
        source: AttendanceSource.CREW_CONFIRM,
        leaveLedgerEntryId: null,
        userId: { notIn: rosterIds },
      },
      select: { id: true, userId: true, date: true },
    });
    let reconciled = 0;
    if (staleRows.length > 0) {
      const deletableIds: string[] = [];
      for (const row of staleRows) {
        // H2 guard, third and last mutation path: don't delete a day already
        // locked into this user's pay just because they left the roster.
        if (await this.isDateInLockedPeriod(tx, vendorId, row.userId, row.date)) continue;
        deletableIds.push(row.id);
      }
      if (deletableIds.length > 0) {
        const res = await tx.staffAttendance.deleteMany({ where: { id: { in: deletableIds } } });
        reconciled = res.count;
      }
    }

    return { captured, reconciled };
  }

  /**
   * True if `date` falls inside a PayrollPeriod for this vendor whose
   * PayrollEntry for `userId` is already LOCKED or SETTLED — i.e. this day's
   * contribution to that employee's pay has already been frozen into a
   * PayrollSnapshot. `captureForConfirmedCrew` must never create, flip, or
   * delete a StaffAttendance row for such a date (merge-review finding H2):
   * doing so would silently change what a future unlock+regenerate computes,
   * with no ledger entry and no audit trail to explain why (StaffAttendance
   * deliberately has none — see the class doc comment).
   */
  private async isDateInLockedPeriod(
    tx: Prisma.TransactionClient,
    vendorId: string,
    userId: string,
    date: Date,
  ): Promise<boolean> {
    const period = await tx.payrollPeriod.findFirst({
      where: { vendorId, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true },
    });
    if (!period) return false;

    const entry = await tx.payrollEntry.findUnique({
      where: { periodId_userId: { periodId: period.id, userId } },
      select: { status: true },
    });
    return entry?.status === PayrollEntryStatus.LOCKED || entry?.status === PayrollEntryStatus.SETTLED;
  }

  /**
   * Manual attendance marking. One `$transaction`: for ABSENT / HALF_DAY it also
   * creates exactly one LEAVE_UNPAID `StaffLedgerEntry` (negative amount,
   * `effectiveDate` = the marked day, never `now()`) via
   * `StaffLedgerService.createTx`, so the attendance row and its financial
   * consequence commit or roll back together.
   *
   * A day that already carries a `leaveLedgerEntryId` is NOT re-marked here —
   * changing a posted ledger entry is the payroll ledger's job (void / reverse /
   * correct), not an attendance endpoint's, and Phase 1 keeps that boundary
   * hard (doc §6.3 C1/C6).
   */
  async markStatus(user: AuthUser, dto: MarkAttendanceDto) {
    const isUnpaid = UNPAID_ATTENDANCE_STATUSES.includes(dto.status);
    if (isUnpaid && (dto.amount == null || dto.amount <= 0)) {
      throw new BadRequestException('An explicit positive `amount` is required for an ABSENT or HALF_DAY marking.');
    }
    if (!isUnpaid && dto.amount != null) {
      throw new BadRequestException('`amount` is only accepted for an ABSENT or HALF_DAY marking.');
    }

    const employee = await this.prisma.user.findFirst({
      where: { id: dto.userId, vendorId: user.vendorId },
      select: { id: true, role: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    // Merge-review finding N1: without this, attendance (and, for ABSENT/
    // HALF_DAY, a real LEAVE_UNPAID ledger entry) could be posted against any
    // account in the vendor — a CUSTOMER, a VENDOR_ADMIN — not just staff.
    if (!PAYROLL_ELIGIBLE_ROLES.includes(employee.role)) {
      throw new BadRequestException(
        `Attendance can only be marked for payroll-eligible staff (${PAYROLL_ELIGIBLE_ROLES.join(', ')}).`,
      );
    }

    const day = startOfUtcDay(new Date(dto.date));

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.staffAttendance.findUnique({
        where: { userId_date: { userId: dto.userId, date: day } },
      });

      if (existing?.leaveLedgerEntryId) {
        throw new ConflictException(
          `Attendance for ${ymd(day)} already has a posted unpaid-leave ledger entry (${existing.leaveLedgerEntryId}). ` +
            'Void or correct that entry through the payroll ledger before re-marking this day.',
        );
      }

      let leaveLedgerEntryId: string | null = null;
      if (isUnpaid) {
        const entry = await this.staffLedger.createTx(tx, user, {
          userId: dto.userId,
          category: StaffLedgerCategory.LEAVE_UNPAID,
          amount: -Math.abs(dto.amount as number),
          effectiveDate: day.toISOString(),
          description:
            dto.note ?? `Unpaid ${dto.status === AttendanceStatus.HALF_DAY ? 'half-day' : 'absence'} — ${ymd(day)}`,
        });
        leaveLedgerEntryId = entry.id;
      }

      const base = {
        vendorId: user.vendorId,
        userId: dto.userId,
        date: day,
        status: dto.status,
        source: AttendanceSource.MANUAL,
        note: dto.note ?? null,
        markedById: user.userId,
        leaveLedgerEntryId,
      };

      return existing
        ? tx.staffAttendance.update({
            where: { id: existing.id },
            data: { ...base, version: { increment: 1 } },
          })
        : tx.staffAttendance.create({ data: base });
    });
  }

  /**
   * Every attendance row whose `date` falls inside a payroll period, one row per
   * employee-day. Vendor-wide view — the controller gates this on
   * `payroll:attendance_view`.
   */
  async listByPeriod(user: AuthUser, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, vendorId: user.vendorId },
    });
    if (!period) throw new NotFoundException('Payroll period not found.');

    return this.prisma.staffAttendance.findMany({
      where: {
        vendorId: user.vendorId,
        date: { gte: startOfUtcDay(period.startDate), lte: startOfUtcDay(period.endDate) },
      },
      orderBy: [{ date: 'asc' }, { userId: 'asc' }],
      include: {
        user: { select: { id: true, name: true, role: true } },
        leaveLedgerEntry: { select: { id: true, category: true, amount: true, status: true } },
      },
    });
  }

  /**
   * One employee's attendance history, most recent first. Self-view for any
   * role; another employee's requires `payroll:attendance_view`.
   */
  async listByEmployee(user: AuthUser, userId: string) {
    await assertCanViewEmployeeAttendance(this.permissions, user, userId);

    const employee = await this.prisma.user.findFirst({
      where: { id: userId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    return this.prisma.staffAttendance.findMany({
      where: { vendorId: user.vendorId, userId },
      orderBy: { date: 'desc' },
      include: { leaveLedgerEntry: { select: { id: true, category: true, amount: true, status: true } } },
    });
  }

  /**
   * All attendance rows captured against one daily sheet. No dedicated
   * permission — access to the sheet itself is already gated at the page level
   * (`daily_sheets:view`), mirroring `CrewCashDistributionService.listForSheet`.
   */
  async listBySheet(user: AuthUser, dailySheetId: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dailySheetId, vendorId: user.vendorId },
      select: { id: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found.');

    return this.prisma.staffAttendance.findMany({
      where: { vendorId: user.vendorId, dailySheetId },
      orderBy: { userId: 'asc' },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
  }
}
