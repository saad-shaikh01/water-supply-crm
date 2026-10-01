import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Records a salary advance handed to an employee out of the van's cash during a
 * Daily Sheet (owner-requested 2026-10-01). `dailySheetId` comes from the route
 * param; `date` is always the sheet's own date. See `SheetAdvance` in schema.prisma.
 */
export class CreateSheetAdvanceDto {
  @IsUUID()
  employeeId: string;

  /** Whole positive rupees only — a magnitude, never signed. */
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Mandatory ONLY when the sheet is already closed (enforced in the service —
   * open-sheet adds stay zero-ceremony): why the advance is being recorded after close.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
