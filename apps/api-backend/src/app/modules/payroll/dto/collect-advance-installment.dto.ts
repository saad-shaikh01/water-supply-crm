import { IsInt, IsOptional, IsPositive } from 'class-validator';

/**
 * `POST /payroll/advance-installments/:id/collect` — `amount` is an optional
 * override of the auto-generated `scheduledAmount` (₨15,000 instead of
 * ₨10,000, or ₨5,000 — either direction, no separate mechanism needed).
 * Service-side validates `amount ?? scheduledAmount <= remainingBalance`.
 */
export class CollectAdvanceInstallmentDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;
}
