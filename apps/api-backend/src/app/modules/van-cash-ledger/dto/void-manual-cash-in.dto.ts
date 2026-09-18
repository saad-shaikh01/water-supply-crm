import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Voids an ACTIVE manual cash-in (status flip to VOIDED — never a DELETE). The
 * secondary action: editing is the normal way to correct an entry. A written
 * reason is mandatory.
 */
export class VoidManualCashInDto {
  /** Optimistic-concurrency token — must match the row's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
