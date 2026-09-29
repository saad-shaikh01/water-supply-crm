import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Shared by the validator below and the service, so the two can never disagree. */
export const VOID_REASON_MIN_LENGTH = 5;

/**
 * Voids a POSTED CustomerDepositEntry. Nothing is edited or deleted: the
 * system posts a REVERSAL entry that cancels the original (same pattern as
 * CustomerFinancialAdjustment's void), so the deposit ledger stays
 * append-only and the reason below is the permanent record of why.
 */
export class VoidDepositEntryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(VOID_REASON_MIN_LENGTH)
  @MaxLength(500)
  reason!: string;
}
