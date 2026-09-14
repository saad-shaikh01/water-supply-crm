import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Staff Attendance & Wage Types — Phase 2. Optional body on
 * `POST /daily-sheets/:id/confirm-crew`. `absentUserIds` are roster members
 * (the driver, or a DailySheetCrew userId) to record as ABSENT for the day
 * instead of PRESENT.
 *
 * Operational only — NO ledger entry is created here (the crew-confirm flow has
 * no amount input). The unpaid-leave deduction is a separate, deliberate step
 * via `POST /payroll/attendance/mark`, which takes an explicit amount. Omitting
 * the body (or sending `{}`) is the unchanged one-click "everyone present" path.
 */
export class ConfirmCrewDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  absentUserIds?: string[];
}
