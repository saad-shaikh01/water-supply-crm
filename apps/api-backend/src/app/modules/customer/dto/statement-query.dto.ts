import { IsOptional, Matches, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

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

  /**
   * When true, the delivery table (and its totals) shows only the selected
   * period's own activity — no carried-forward "Previous Balance" row/opening
   * balance mixed into the running balance column. The Balance Due figure is
   * unaffected — it still reflects the true outstanding balance as of the end
   * of the selected period.
   */
  @IsOptional()
  @Transform(({ obj }) => obj.periodOnly === 'true' || obj.periodOnly === true)
  @IsBoolean()
  periodOnly?: boolean;
}
