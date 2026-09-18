import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /van-cash-ledger/periods/:label/reopen */
export class ReopenPeriodDto {
  /** Mandatory, ≥ 10 characters after trimming. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
