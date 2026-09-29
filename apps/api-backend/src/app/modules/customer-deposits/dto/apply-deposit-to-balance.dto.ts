import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Closure Settlement (owner-requested 2026-09-29) — returns part or all of a
 * CASH deposit to the customer as a CREDIT against what they owe, instead of
 * physical cash. No Cash Ledger movement (nothing physically left the office).
 */
export class ApplyDepositToBalanceDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
