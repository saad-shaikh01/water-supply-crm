import { IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * Approves a PENDING VanCashHandover. `approvedAmount`, when supplied and
 * different from the handover's own `amount`, requires `adjustmentReason` —
 * enforced in the service (a DTO-level conditional validator would need
 * cross-field access to the current row's `amount`, which the DTO never has).
 */
export class ApproveHandoverDto {
  /** Optimistic-concurrency token — must match the handover's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsNumber()
  approvedAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adjustmentReason?: string;
}
