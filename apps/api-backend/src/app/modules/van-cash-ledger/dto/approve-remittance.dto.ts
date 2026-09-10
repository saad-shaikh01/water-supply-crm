import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Approves a PENDING OfficeCashRemittance. Mirrors ApproveHandoverDto:
 *   - `approvedAmount`, when supplied and different from the row's `amount`,
 *     requires `adjustmentReason` (enforced in the service — a DTO-level
 *     conditional validator would need the current row's amount).
 *   - `negativeOverrideReason` is required (enforced in the service) when the
 *     approval would drive the office cash balance below zero — a soft gate,
 *     never a hard block (see the plan's real-world rationale §7).
 */
export class ApproveRemittanceDto {
  /** Optimistic-concurrency token — must match the row's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  approvedAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adjustmentReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  negativeOverrideReason?: string;
}
