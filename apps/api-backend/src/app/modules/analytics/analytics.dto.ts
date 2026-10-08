import { IsOptional, IsDateString, IsUUID, IsString, Matches, IsInt, Min, Max, IsIn, MaxLength } from 'class-validator';
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

/** Main P&L read — optionally with "actual cost" adjustments applied (comma-separated AdjustmentKeys). */
export class ProfitLossSummaryQueryDto extends ProfitLossQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  adjust?: string;

  /** ACTUAL keeps the adjustment rows visible even when none is selected. */
  @IsOptional()
  @IsIn(['CASH', 'ACTUAL'])
  basis?: string;

  /** What-if planning: rate per bottle that replaces the plant (bottle refill) cost. Never stored. */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1000000)
  plantRate?: number;

  /** What-if planning: rate per bottle that replaces the caps cost. Never stored. */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1000000)
  capsRate?: number;

  /** Which bottle count the what-if rates multiply. */
  @IsOptional()
  @IsIn(['DELIVERED', 'NET'])
  whatIfBasis?: string;
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

export class ProfitLossPaymentsQueryDto extends ProfitLossQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'SHEET', 'CASH', 'BANK_TRANSFER', 'CHEQUE'])
  kind?: string;

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
