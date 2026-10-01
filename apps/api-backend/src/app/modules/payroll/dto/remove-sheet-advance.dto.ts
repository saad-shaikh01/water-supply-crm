import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Voids a Sheet Advance (soft — the row is kept). `reason` is mandatory ONLY when
 * the sheet is already closed (enforced in the service); on an open sheet it is
 * optional, matching "zero ceremony" for same-day fixes.
 */
export class RemoveSheetAdvanceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
