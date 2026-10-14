import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Undo a COLLECTED installment so its amount rolls into the next period — the reason is optional, a default is audited. */
export class ReverseAdvanceInstallmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
