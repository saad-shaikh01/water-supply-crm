import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Shared by the validator below and the service, so the two can never disagree. */
export const VOID_REASON_MIN_LENGTH = 5;

/**
 * Voids a POSTED Customer Financial Adjustment. Nothing is edited or deleted: the
 * system posts a REVERSAL that cancels the original, so the ledger stays append-only
 * and the reason below is the permanent record of why.
 */
export class VoidCustomerFinancialAdjustmentDto {
  /**
   * Why is this being voided? Mandatory, staff-only — recorded on the original
   * (`voidReason`), on the reversal document and in the audit trail. Never shown to
   * the customer.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(VOID_REASON_MIN_LENGTH)
  @MaxLength(500)
  reason: string;
}
