import { IsOptional, IsDateString, IsUUID } from 'class-validator';

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
