import { IsDateString, IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * `POST /payroll/advance-plans` — turns a cash advance into an installment
 * loan. `principalAmount` is disbursed in full, immediately, as a single
 * ADVANCE_DISBURSEMENT ledger entry; `defaultInstallmentAmount` only sizes
 * the recovery installments `PayrollEntryService.generateDraft()` will
 * auto-generate each period going forward — it is not itself posted anywhere.
 */
export class CreateAdvancePlanDto {
  @IsUUID()
  userId: string;

  @IsInt()
  @IsPositive()
  principalAmount: number;

  @IsInt()
  @IsPositive()
  defaultInstallmentAmount: number;

  @IsDateString()
  disbursedAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
