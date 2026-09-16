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

  // Reads `obj` (the raw query value), not `value` — the global ValidationPipe's
  // `enableImplicitConversion` runs first for a `boolean`-typed field and coerces ANY
  // non-empty string (including 'false') to `true` via `Boolean(value)` before this
  // `@Transform` ran, which made `isClosed=false` (e.g. sheet-picker-dialog.tsx) silently
  // resolve to `true` — the opposite filter.
  @IsOptional()
  @Transform(({ obj }) => obj.isClosed === 'true' || obj.isClosed === true)
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
