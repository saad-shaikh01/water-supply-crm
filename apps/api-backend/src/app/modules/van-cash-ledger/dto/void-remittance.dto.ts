import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Voids an OfficeCashRemittance (status flip to VOIDED — never a DELETE). A
 * written reason is mandatory (SOP §8.1). Voiding an already-APPROVED row
 * additionally requires `van_cash_ledger:remit_void`, checked in the service.
 */
export class VoidRemittanceDto {
  /** Optimistic-concurrency token — must match the row's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  voidReason: string;
}
