import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Corrects an OfficeCashRemittance chain. `newAmount` is the intended NEW TOTAL
 * for the logical remittance (root + every non-voided correction). Mirrors
 * VanCashLedgerService.handlePostCloseCorrection:
 *   - a still-PENDING standalone original is rewritten in place;
 *   - an APPROVED original (or an existing chain) gets a NEW row carrying the
 *     DELTA (`newAmount - currentTotal`), which is itself PENDING and goes
 *     through its own approval.
 * A written reason is mandatory (SOP §8.1).
 */
export class CorrectRemittanceDto {
  /** Optimistic-concurrency token — must match the target row's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsNumber()
  @Min(0.01)
  newAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  correctionReason: string;
}
