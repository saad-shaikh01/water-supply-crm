import { IsOptional, Matches } from 'class-validator';

export class StatementQueryDto {
  /** Start month (or the only month, when toMonth is omitted). Format YYYY-MM. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  /**
   * End month for a multi-month range statement — combines `month`..`toMonth`
   * into a single continuous ledger (one opening/closing balance) instead of
   * one PDF per month. Omit for the existing single-month behaviour.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'toMonth must be in YYYY-MM format' })
  toMonth?: string;
}
