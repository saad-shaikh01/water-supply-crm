import { IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

/** `dto.status` values for which `categoryId` is accepted (and required). */
export const CATEGORIZED_ATTENDANCE_STATUSES: AttendanceStatus[] = [AttendanceStatus.PRESENT];

/**
 * Attendance statuses that mean "unpaid time" and therefore bridge to a
 * LEAVE_UNPAID StaffLedgerEntry. A paid LEAVE day is recorded as status LEAVE
 * (no ledger effect) — payroll decides paid-vs-unpaid, not attendance
 * (docs/features/staff-attendance-and-wage-types.md §3 D1, §4 Phase 1).
 */
export const UNPAID_ATTENDANCE_STATUSES: AttendanceStatus[] = [
  AttendanceStatus.ABSENT,
  AttendanceStatus.HALF_DAY,
];

/**
 * Manual attendance marking (`POST /payroll/attendance/mark`).
 *
 * `amount` is an OPTIONAL explicit rupee magnitude to debit immediately for an
 * unpaid day (ABSENT / HALF_DAY); rejected for every other status. Deduction
 * is normally decided later by the admin when payroll is actually built, not
 * at mark-time — so leaving it blank just records the day operationally, with
 * no ledger entry. If given, no hidden per-day divisor logic (doc §6.3 C7):
 * the caller supplies the number; the service applies the debit sign. `date`
 * is the attended calendar day and becomes the `effectiveDate` of any spawned
 * ledger entry verbatim — never "now".
 */
export class MarkAttendanceDto {
  @IsUUID()
  userId: string;

  @IsDateString()
  date: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Whole positive rupees. Only accepted when `status` is ABSENT or HALF_DAY; always optional. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  /**
   * Required when `status` is PRESENT — an `AttendanceCategory` id explaining
   * why this was a manual present marking rather than regular crew duty (e.g.
   * "office — other business"). Rejected for every other status. See the
   * schema comment on `StaffAttendance.categoryId`.
   */
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
