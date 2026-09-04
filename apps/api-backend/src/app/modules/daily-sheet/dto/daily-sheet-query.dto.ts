import { IsOptional, IsDateString, IsUUID, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class DailySheetQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isClosed?: boolean;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';

  // Walk-in / Self-Pickup Delivery (docs/features/walk-in-delivery.md).
  // Omitted → only ROUTE sheets (the synthetic WALK_IN sheets are hidden from
  // the main list). 'WALK_IN' → only walk-in sheets. 'ALL' → both.
  @IsOptional()
  @IsIn(['ROUTE', 'WALK_IN', 'ALL'])
  kind?: 'ROUTE' | 'WALK_IN' | 'ALL';
}
