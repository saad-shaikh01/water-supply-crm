import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /van-cash-ledger/periods/:label/close */
export class ClosePeriodDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Required (true) when the close-check reports warnings. Read from `obj` — with
   * `enableImplicitConversion`, `value` would already be `Boolean('false') === true`
   * (S46 boolean-transform pattern).
   */
  @IsOptional()
  @Transform(({ obj }) =>
    obj.acknowledgeWarnings === undefined || obj.acknowledgeWarnings === null
      ? undefined
      : obj.acknowledgeWarnings === 'true' || obj.acknowledgeWarnings === true,
  )
  @IsBoolean()
  acknowledgeWarnings?: boolean;
}
