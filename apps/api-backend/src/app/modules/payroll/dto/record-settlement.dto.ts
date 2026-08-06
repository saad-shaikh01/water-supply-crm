import { IsEnum, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { SettlementMethod } from '@prisma/client';

export class RecordSettlementDto {
  /**
   * Whole rupees, must be positive — a zero or negative settlement doesn't
   * mean anything. No upper-bound check against the entry's remaining
   * balance: partial AND over- payment are both allowed (§7 "supports
   * partial payment"; over/under-payment flows into carry-forward next
   * period per §5, not something this endpoint blocks).
   */
  @IsInt()
  @Min(1)
  amount: number;

  @IsEnum(SettlementMethod)
  method: SettlementMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  referenceNote?: string;
}
