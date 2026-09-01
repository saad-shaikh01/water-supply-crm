import { IsInt, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Post-Close Trip Correction — amend an already-checked-in load trip's physical
 * counts on a CLOSED sheet. Mirrors `CheckinLoadDto`'s four count fields (minus
 * `forceResubmit`, which is a trip-edit-unlock concern that does not apply to the
 * dedicated closed-sheet endpoint) and adds a mandatory free-text note that is
 * persisted only in the audit `after` block.
 */
export class CorrectClosedTripDto {
  @IsInt()
  @Min(0)
  returnedFilled!: number;

  @IsInt()
  @Min(0)
  collectedEmpty!: number;

  @IsInt()
  @Min(0)
  damagedOnVan!: number;

  @IsInt()
  @Min(0)
  leakedOnVan!: number;

  // Trim first so an all-whitespace note ("   ") collapses to "" and is then
  // rejected by @MinLength(3) instead of sneaking past it (same style as
  // void-delivery.dto.ts).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  correctionNote!: string;
}
