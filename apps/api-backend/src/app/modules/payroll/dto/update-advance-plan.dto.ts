import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * `PATCH /payroll/advance-plans/:id` — changes the STANDING default for
 * future installments only. Never rewrites an already-COLLECTED/SKIPPED row —
 * matches `SalaryStructure`'s append-only versioning philosophy: a one-off
 * override for a single period is `amount` on `CollectAdvanceInstallmentDto`
 * instead, not this endpoint.
 */
export class UpdateAdvancePlanDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  defaultInstallmentAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
