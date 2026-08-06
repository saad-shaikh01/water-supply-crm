import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, NotEquals } from 'class-validator';
import { StaffLedgerCategory } from '@prisma/client';

/**
 * REVERSAL and CORRECTION are system-generated categories only — produced by
 * `StaffLedgerService.reverse()`/`correct()`, never directly creatable
 * through this DTO.
 */
export const CREATABLE_LEDGER_CATEGORIES = Object.values(StaffLedgerCategory).filter(
  (category) => category !== StaffLedgerCategory.REVERSAL && category !== StaffLedgerCategory.CORRECTION,
);

export class CreateStaffLedgerEntryDto {
  @IsUUID()
  userId: string;

  @IsIn(CREATABLE_LEDGER_CATEGORIES)
  category: StaffLedgerCategory;

  /**
   * Signed whole rupees — positive = credit toward the employee (bonus,
   * incentive...), negative = debit against the employee (penalty,
   * deduction...). Zero is meaningless for a ledger event, so it's rejected.
   */
  @IsInt()
  @NotEquals(0)
  amount: number;

  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
