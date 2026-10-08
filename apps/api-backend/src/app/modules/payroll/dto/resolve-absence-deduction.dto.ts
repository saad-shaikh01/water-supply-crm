import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * What to do with a set of ABSENT / HALF_DAY days:
 *   - UNPAID — deduct (posts one LEAVE_UNPAID ledger entry per day, at `dailyRate`;
 *              a HALF_DAY is charged half of it)
 *   - WAIVE  — explicitly paid / waived: no deduction, recorded as a decision
 *   - RESET  — undo a previous decision: voids a not-yet-locked deduction and/or
 *              clears a waiver, returning the day to "pending decision"
 */
export enum AbsenceDecisionAction {
  UNPAID = 'UNPAID',
  WAIVE = 'WAIVE',
  RESET = 'RESET',
}

/** Sanity ceiling on a single day's deduction (whole rupees) - far above any real daily wage, far below the Int column. */
export const MAX_ABSENCE_DAILY_RATE = 10_000_000;

/** Hard ceiling on one request — a payroll period is at most ~31 days, 62 leaves room for odd cutoffs. */
export const MAX_ABSENCE_DECISION_DAYS = 62;

/** `POST /payroll/attendance/resolve-absences` — bulk paid/unpaid decision for one employee's days. */
export class ResolveAbsenceDeductionDto {
  @IsUUID()
  userId: string;

  /**
   * Plain calendar days, `YYYY-MM-DD` (attendance is keyed by calendar day - a timestamp with an offset would be
   * shifted to a neighbouring UTC day, so it is rejected rather than silently reinterpreted). All must be
   * ABSENT / HALF_DAY rows.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ABSENCE_DECISION_DAYS)
  @ArrayUnique()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { each: true, message: 'each date must be a YYYY-MM-DD calendar day' })
  dates: string[];

  @IsEnum(AbsenceDecisionAction)
  action: AbsenceDecisionAction;

  /** Whole rupees per full absent day. Required for UNPAID, rejected otherwise. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_ABSENCE_DAILY_RATE)
  dailyRate?: number;

  /** Reason shown on the waiver / ledger entry / void audit. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
