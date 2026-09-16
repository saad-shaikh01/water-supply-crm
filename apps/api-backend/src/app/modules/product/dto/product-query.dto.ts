import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  // Reads `obj` (the raw query value), not `value` — the global ValidationPipe's
  // `enableImplicitConversion` runs first for a `boolean`-typed field and coerces ANY
  // non-empty string (including 'false') to `true` via `Boolean(value)` before this
  // `@Transform` ran, which made 'false' silently resolve to `true` here.
  @IsOptional()
  @Transform(({ obj }) => obj.isActive === 'true' || obj.isActive === true)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'asc';
}
