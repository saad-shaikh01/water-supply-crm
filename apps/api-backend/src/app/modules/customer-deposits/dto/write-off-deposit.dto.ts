import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Shared by the validator below and the service, so the two can never disagree. */
export const WRITE_OFF_NOTE_MIN_LENGTH = 5;

/**
 * Closes out part or all of a CustomerDeposit's held balance WITHOUT a
 * matching cash/bottle movement (e.g. a customer left without returning the
 * bottles held as their deposit). A mandatory note is the permanent record
 * of why.
 */
export class WriteOffDepositDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(WRITE_OFF_NOTE_MIN_LENGTH)
  @MaxLength(500)
  note!: string;
}
