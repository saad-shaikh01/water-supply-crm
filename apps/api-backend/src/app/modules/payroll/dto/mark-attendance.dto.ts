import { IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

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
 * `amount` is the explicit rupee magnitude to debit for an unpaid day — REQUIRED
 * for ABSENT / HALF_DAY, rejected for every other status. No hidden per-day
 * divisor logic (doc §6.3 C7): the caller supplies the number; the service
 * applies the debit sign. `date` is the attended calendar day and becomes the
 * `effectiveDate` of any spawned ledger entry verbatim — never "now".
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

  /** Whole positive rupees. Required iff `status` is ABSENT or HALF_DAY. */
  @ValidateIf((o) => UNPAID_ATTENDANCE_STATUSES.includes(o.status))
  @IsInt()
  @IsPositive()
  amount?: number;
}
