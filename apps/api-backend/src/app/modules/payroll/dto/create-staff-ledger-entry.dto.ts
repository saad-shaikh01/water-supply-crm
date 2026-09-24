import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, NotEquals } from 'class-validator';
import { StaffLedgerCategory } from '@prisma/client';

/**
 * REVERSAL and CORRECTION are system-generated categories only — produced by
 * `StaffLedgerService.reverse()`/`correct()`, never directly creatable
 * through this DTO. ADVANCE_DISBURSEMENT/ADVANCE_RECOVERY are likewise
 * system-generated only — produced exclusively by `StaffAdvancePlanService`
 * (plan creation / installment collection) so a plan's principal and its
 * remaining balance can never drift from what was actually posted through
 * this generic endpoint.
 */
const SYSTEM_ONLY_LEDGER_CATEGORIES: StaffLedgerCategory[] = [
  StaffLedgerCategory.REVERSAL,
  StaffLedgerCategory.CORRECTION,
  StaffLedgerCategory.ADVANCE_DISBURSEMENT,
  StaffLedgerCategory.ADVANCE_RECOVERY,
];

export const CREATABLE_LEDGER_CATEGORIES = Object.values(StaffLedgerCategory).filter(
  (category) => !SYSTEM_ONLY_LEDGER_CATEGORIES.includes(category),
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
