import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Edits a Sheet Advance in place. Every field except `version` is optional, but at
 * least one must actually differ from the stored row (enforced in the service).
 * Only allowed while the advance's payroll twin has not been rolled into a locked
 * payroll period — afterwards delete it (which reverses it in the current period)
 * and record a new one.
 */
export class UpdateSheetAdvanceDto {
  /** Optimistic-concurrency token — must match the advance's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Whole positive rupees only — a magnitude, never signed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Mandatory ONLY when the sheet is closed (enforced in the service). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
