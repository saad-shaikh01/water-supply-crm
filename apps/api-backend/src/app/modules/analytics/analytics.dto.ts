import { IsOptional, IsDateString, IsUUID, IsString, Matches, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class DateRangeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Van-wise filter (owner-requested 2026-09-15) — when set, every analytics
  // tab scopes its stats to this one van instead of the vendor-wide default.
  @IsOptional()
  @IsUUID()
  vanId?: string;
}

/** Profit & Loss tab — one calendar month (YYYY-MM, vendor/PKT). Company-wide by design: no van filter. */
export class ProfitLossQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' })
  month?: string;
}

export class ProfitLossDetailsQueryDto extends ProfitLossQueryDto {
  @IsString()
  category!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
